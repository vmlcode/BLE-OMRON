import { Buffer } from 'buffer';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Characteristic, type Device, type Subscription } from 'react-native-ble-plx';

const OMRON_COMPANY_ID = 0x020e;

const CHARACTERISTICS = {
  BLOOD_PRESSURE_MEASUREMENT: '2A35',
  WEIGHT_MEASUREMENT: '2A9D',
  BODY_COMPOSITION_MEASUREMENT: '2A9C',
  TEMPERATURE_MEASUREMENT: '2A1C',
  RECORD_ACCESS_CONTROL_POINT: '2A52',
  OMRON_PLX_SPOT_CHECK: '6E4000F1-B5A3-F393-EFA9-E50E24DCCA9E'
};

const RACP_OPCODES = {
  REPORT_STORED_RECORDS: 0x01,
  REPORT_NUMBER_OF_STORED_RECORDS: 0x04,
  NUMBER_OF_STORED_RECORDS_RESPONSE: 0x05,
  RESPONSE_CODE: 0x06
};

const RACP_OPERATORS = {
  ALL_RECORDS: 0x01
};

export type OmronUserInfo = {
  index: number;
  lastSequenceNumber: number;
  numberOfRecords: number;
};

export type OmronAdvertisingInfo = {
  pairable: boolean;
  timeNotConfigured: boolean;
  numberOfUsers: number;
  users: OmronUserInfo[];
};

export type OmronDiscoveredDevice = Device & OmronAdvertisingInfo;

export type BloodPressureMeasurement = {
  type: 'blood_pressure';
  systolic: number;
  diastolic: number;
  meanArterialPressure: number;
  pulse: number | null;
  timestamp: Date;
  unit: 'mmHg';
};

export type WeightMeasurement = {
  type: 'weight';
  weight: number;
  timestamp: Date;
  unit: 'kg';
};

export type TemperatureMeasurement = {
  type: 'temperature';
  temperature: number;
  timestamp: Date;
  unit: '°C';
};

export type BodyCompositionMeasurement = {
  type: 'body_composition';
  timestamp: Date;
  bodyFatPercentage?: number;
  muscleMass?: number;
};

export type OmronMeasurement =
  | BloodPressureMeasurement
  | WeightMeasurement
  | TemperatureMeasurement
  | BodyCompositionMeasurement;

export type UseOmronBluetoothOptions = {
  autoScanOnBluetoothOn?: boolean;
  scanTimeoutMs?: number;
  requestMtu?: number;
  logLimit?: number;
};

const DEFAULT_OPTIONS: Required<UseOmronBluetoothOptions> = {
  autoScanOnBluetoothOn: true,
  scanTimeoutMs: 10000,
  requestMtu: 150,
  logLimit: 20
};

export function useOmronBluetooth(options?: UseOmronBluetoothOptions) {
  const { autoScanOnBluetoothOn, scanTimeoutMs, requestMtu, logLimit } = { ...DEFAULT_OPTIONS, ...options };

  const [devices, setDevices] = useState<OmronDiscoveredDevice[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [connectionState, setConnectionState] = useState<string>('Disconnected');
  const [measurementData, setMeasurementData] = useState<OmronMeasurement[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  const managerRef = useRef<BleManager | null>(null);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscriptionsRef = useRef<Subscription[]>([]);

  if (!managerRef.current) {
    managerRef.current = new BleManager();
  }

  const addLog = useCallback(
    (message: string) => {
      const timestamp = new Date().toLocaleTimeString();
      setLogs(prev => [...prev.slice(-Math.max(logLimit - 1, 0)), `[${timestamp}] ${message}`]);
      console.log(message);
    },
    [logLimit]
  );

  const requestPermissions = useCallback(async () => {
    if (Platform.OS !== 'android') {
      return;
    }

    await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
    ]);
  }, []);

  const parseOmronManufacturerData = useCallback(
    (base64Data: string): OmronAdvertisingInfo | null => {
      try {
        const buffer = Buffer.from(base64Data, 'base64');
        const companyId = buffer.readUInt16LE(0);
        const type = buffer.readUInt8(2);

        if (companyId !== OMRON_COMPANY_ID || type !== 0x01) return null;

        const flags = buffer.readUInt8(3);
        const pairable = (flags & 0b1000) !== 0;
        const timeNotConfigured = (flags & 0b0100) !== 0;
        const numberOfUsers = (flags & 0b0011) + 1;

        const users: OmronUserInfo[] = [];
        let offset = 4;

        for (let i = 0; i < numberOfUsers; i++) {
          const lastSequenceNumber = buffer.readUInt16LE(offset);
          offset += 2;
          const numberOfRecords = buffer.readUInt8(offset++);
          users.push({ index: i + 1, lastSequenceNumber, numberOfRecords });
        }

        return {
          pairable,
          timeNotConfigured,
          numberOfUsers,
          users
        };
      } catch (err) {
        addLog(`Parse error: ${err}`);
        return null;
      }
    },
    [addLog]
  );

  const isMeasurementCharacteristic = useCallback((uuid: string): boolean => {
    const measurementUUIDs = [
      CHARACTERISTICS.BLOOD_PRESSURE_MEASUREMENT,
      CHARACTERISTICS.WEIGHT_MEASUREMENT,
      CHARACTERISTICS.BODY_COMPOSITION_MEASUREMENT,
      CHARACTERISTICS.TEMPERATURE_MEASUREMENT,
      CHARACTERISTICS.OMRON_PLX_SPOT_CHECK
    ];
    return measurementUUIDs.some(muuid => uuid.toUpperCase().includes(muuid.toUpperCase()));
  }, []);

  const parseBloodPressureData = useCallback((buffer: Buffer): BloodPressureMeasurement => {
    const flags = buffer.readUInt8(0);
    let offset = 1;

    const readSFloat = () => {
      const raw = buffer.readUInt16LE(offset);
      offset += 2;
      const mantissa = raw & 0x0fff;
      const exponent = raw >> 12;

      const signedMantissa = mantissa >= 0x0800 ? mantissa - 0x1000 : mantissa;
      const signedExponent = exponent >= 0x08 ? exponent - 0x10 : exponent;

      return signedMantissa * Math.pow(10, signedExponent);
    };

    const systolic = readSFloat();
    const diastolic = readSFloat();
    const meanArterialPressure = readSFloat();

    let timestamp: Date | null = null;
    if (flags & 0x02) {
      const year = buffer.readUInt16LE(offset);
      const month = buffer.readUInt8(offset + 2);
      const day = buffer.readUInt8(offset + 3);
      const hour = buffer.readUInt8(offset + 4);
      const minute = buffer.readUInt8(offset + 5);
      const second = buffer.readUInt8(offset + 6);
      offset += 7;

      timestamp = new Date(year, month - 1, day, hour, minute, second);
    }

    let pulse: number | null = null;
    if (flags & 0x04) {
      pulse = readSFloat();
    }

    return {
      type: 'blood_pressure',
      systolic,
      diastolic,
      meanArterialPressure,
      pulse,
      timestamp: timestamp || new Date(),
      unit: 'mmHg'
    };
  }, []);

  const parseWeightData = useCallback((buffer: Buffer): WeightMeasurement => {
    const flags = buffer.readUInt8(0);
    let offset = 1;

    const weightRaw = buffer.readUInt16LE(offset);
    offset += 2;

    const weight = weightRaw * 0.005;

    let timestamp: Date | null = null;
    if (flags & 0x02) {
      const year = buffer.readUInt16LE(offset);
      const month = buffer.readUInt8(offset + 2);
      const day = buffer.readUInt8(offset + 3);
      const hour = buffer.readUInt8(offset + 4);
      const minute = buffer.readUInt8(offset + 5);
      const second = buffer.readUInt8(offset + 6);

      timestamp = new Date(year, month - 1, day, hour, minute, second);
    }

    return {
      type: 'weight',
      weight,
      timestamp: timestamp || new Date(),
      unit: 'kg'
    };
  }, []);

  const parseTemperatureData = useCallback(
    (buffer: Buffer): TemperatureMeasurement => {
      const flags = buffer.readUInt8(0);
      let offset = 1;

      const tempRaw = buffer.readFloatLE(offset);
      offset += 4;

      let timestamp: Date | null = null;
      if (flags & 0x02) {
        const year = buffer.readUInt16LE(offset);
        const month = buffer.readUInt8(offset + 2);
        const day = buffer.readUInt8(offset + 3);
        const hour = buffer.readUInt8(offset + 4);
        const minute = buffer.readUInt8(offset + 5);
        const second = buffer.readUInt8(offset + 6);

        timestamp = new Date(year, month - 1, day, hour, minute, second);
      }

      const tempCelsius = flags & 0x01 ? tempRaw : ((tempRaw - 32) * 5) / 9;

      return {
        type: 'temperature',
        temperature: tempCelsius,
        timestamp: timestamp || new Date(),
        unit: '°C'
      };
    },
    []
  );

  const parseBodyCompositionData = useCallback((buffer: Buffer): BodyCompositionMeasurement => {
    const flags = buffer.readUInt16LE(0);
    let offset = 2;

    const data: BodyCompositionMeasurement = {
      type: 'body_composition',
      timestamp: new Date()
    };

    if (flags & 0x02) {
      data.bodyFatPercentage = buffer.readUInt16LE(offset) / 10;
      offset += 2;
    }

    if (flags & 0x20) {
      data.muscleMass = buffer.readUInt16LE(offset) / 10;
      offset += 2;
    }

    return data;
  }, []);

  const parseMeasurementData = useCallback(
    (characteristicUUID: string, base64Value: string): OmronMeasurement | null => {
      try {
        const buffer = Buffer.from(base64Value, 'base64');
        const uuid = characteristicUUID.toUpperCase();

        if (uuid.includes(CHARACTERISTICS.BLOOD_PRESSURE_MEASUREMENT)) {
          return parseBloodPressureData(buffer);
        }

        if (uuid.includes(CHARACTERISTICS.WEIGHT_MEASUREMENT)) {
          return parseWeightData(buffer);
        }

        if (uuid.includes(CHARACTERISTICS.TEMPERATURE_MEASUREMENT)) {
          return parseTemperatureData(buffer);
        }

        if (uuid.includes(CHARACTERISTICS.BODY_COMPOSITION_MEASUREMENT)) {
          return parseBodyCompositionData(buffer);
        }

        return null;
      } catch (error: any) {
        addLog(`Parse error: ${error.message}`);
        return null;
      }
    },
    [addLog, parseBloodPressureData, parseBodyCompositionData, parseTemperatureData, parseWeightData]
  );

  const stopScan = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) return;

    manager.stopDeviceScan();

    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
  }, []);

  const scanDevices = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) return;

    addLog('Starting device scan...');
    setDevices([]);

    stopScan();

    manager.startDeviceScan(null, null, (error, device) => {
      if (error) {
        addLog(`Scan error: ${error.message}`);
        return;
      }

      if (!device?.manufacturerData) return;

      const parsed = parseOmronManufacturerData(device.manufacturerData);
      if (!parsed) return;

      setDevices(prev => {
        const exists = prev.find(d => d.id === device.id);
        if (exists) return prev;

        addLog(`Found Omron device: ${device.name || 'Unknown'}`);
        const enriched = Object.assign(device, parsed) as OmronDiscoveredDevice;
        return [...prev, enriched];
      });
    });

    scanTimeoutRef.current = setTimeout(() => {
      stopScan();
      addLog('Scan stopped');
    }, scanTimeoutMs);
  }, [addLog, parseOmronManufacturerData, scanTimeoutMs, stopScan]);

  const removeAllSubscriptions = useCallback(() => {
    for (const sub of subscriptionsRef.current) {
      try {
        sub.remove();
      } catch {
        // ignore
      }
    }
    subscriptionsRef.current = [];
  }, []);

  const setupNotification = useCallback(
    async (characteristic: Characteristic) => {
      try {
        const sub = characteristic.monitor((error, char) => {
          if (error) {
            addLog(`Notification error: ${error.message}`);
            return;
          }

          if (char?.value) {
            const data = parseMeasurementData(characteristic.uuid, char.value);
            if (data) {
              addLog(`Received measurement: ${JSON.stringify(data)}`);
              setMeasurementData(prev => [...prev, data]);
            }
          }
        });

        subscriptionsRef.current.push(sub);
        addLog(`Notifications enabled for ${characteristic.uuid}`);
      } catch (error: any) {
        addLog(`Failed to setup notification: ${error.message}`);
      }
    },
    [addLog, parseMeasurementData]
  );

  const requestAllStoredRecords = useCallback(
    async (device: Device, racpChar: Characteristic) => {
      try {
        const command = Buffer.alloc(2);
        command.writeUInt8(RACP_OPCODES.REPORT_STORED_RECORDS, 0);
        command.writeUInt8(RACP_OPERATORS.ALL_RECORDS, 1);

        await racpChar.writeWithResponse(command.toString('base64'));
        addLog('Requested all stored records');
      } catch (error: any) {
        addLog(`Failed to request records: ${error.message}`);
      }
    },
    [addLog]
  );

  const handleRACPResponse = useCallback(
    async (device: Device, base64Value: string, racpChar: Characteristic) => {
      try {
        const buffer = Buffer.from(base64Value, 'base64');
        const opCode = buffer.readUInt8(0);

        switch (opCode) {
          case RACP_OPCODES.NUMBER_OF_STORED_RECORDS_RESPONSE: {
            const numberOfRecords = buffer.readUInt16LE(2);
            addLog(`Device has ${numberOfRecords} stored records`);

            if (numberOfRecords > 0) {
              await requestAllStoredRecords(device, racpChar);
            }
            break;
          }

          case RACP_OPCODES.RESPONSE_CODE: {
            const requestOpCode = buffer.readUInt8(2);
            const responseValue = buffer.readUInt8(3);
            addLog(`RACP Response: OpCode=${requestOpCode}, Value=${responseValue}`);
            break;
          }
        }
      } catch (error: any) {
        addLog(`RACP response error: ${error.message}`);
      }
    },
    [addLog, requestAllStoredRecords]
  );

  const requestStoredRecords = useCallback(
    async (device: Device) => {
      try {
        const services = await device.services();
        let racpChar: Characteristic | null = null;

        for (const service of services) {
          const characteristics = await service.characteristics();
          racpChar =
            characteristics.find(c => c.uuid.toUpperCase().includes(CHARACTERISTICS.RECORD_ACCESS_CONTROL_POINT)) || null;
          if (racpChar) break;
        }

        if (!racpChar) {
          addLog('RACP characteristic not found');
          return;
        }

        const sub = racpChar.monitor((error, char) => {
          if (error) {
            addLog(`RACP error: ${error.message}`);
            return;
          }

          if (char?.value) {
            void handleRACPResponse(device, char.value, racpChar);
          }
        });
        subscriptionsRef.current.push(sub);

        const command = Buffer.alloc(2);
        command.writeUInt8(RACP_OPCODES.REPORT_NUMBER_OF_STORED_RECORDS, 0);
        command.writeUInt8(RACP_OPERATORS.ALL_RECORDS, 1);

        await racpChar.writeWithResponse(command.toString('base64'));
        addLog('Requested number of stored records');
      } catch (error: any) {
        addLog(`RACP request failed: ${error.message}`);
      }
    },
    [addLog, handleRACPResponse]
  );

  const setupDataTransfer = useCallback(
    async (device: Device) => {
      try {
        const services = await device.services();

        for (const service of services) {
          const characteristics = await service.characteristics();

          for (const char of characteristics) {
            if (isMeasurementCharacteristic(char.uuid)) {
              await setupNotification(char);
            }
          }
        }

        await requestStoredRecords(device);
      } catch (error: any) {
        addLog(`Setup failed: ${error.message}`);
      }
    },
    [addLog, isMeasurementCharacteristic, requestStoredRecords, setupNotification]
  );

  const connectToDevice = useCallback(
    async (device: Device) => {
      const manager = managerRef.current;
      if (!manager) return;

      try {
        stopScan();
        removeAllSubscriptions();
        setMeasurementData([]);

        setConnectionState('Connecting...');
        addLog(`Connecting to ${device.name}...`);

        const connectedDev = await manager.connectToDevice(device.id, { requestMTU: requestMtu });

        setConnectedDevice(connectedDev);
        setConnectionState('Connected');
        addLog(`Connected to ${device.name}`);

        await connectedDev.discoverAllServicesAndCharacteristics();
        addLog('Services discovered');

        await setupDataTransfer(connectedDev);
      } catch (error: any) {
        addLog(`Connection failed: ${error.message}`);
        setConnectionState('Connection Failed');
      }
    },
    [addLog, removeAllSubscriptions, requestMtu, setupDataTransfer, stopScan]
  );

  const disconnect = useCallback(async () => {
    const manager = managerRef.current;
    if (!manager || !connectedDevice) {
      return;
    }

    try {
      removeAllSubscriptions();
      await manager.cancelDeviceConnection(connectedDevice.id);
    } catch {
      // ignore
    } finally {
      setConnectedDevice(null);
      setConnectionState('Disconnected');
      addLog('Disconnected from device');
    }
  }, [addLog, connectedDevice, removeAllSubscriptions]);

  useEffect(() => {
    void requestPermissions();

    const manager = managerRef.current;
    if (!manager) {
      return;
    }

    const subscription = manager.onStateChange(state => {
      if (state === 'PoweredOn' && autoScanOnBluetoothOn) {
        scanDevices();
      }
    }, true);

    subscriptionsRef.current.push(subscription);

    return () => {
      stopScan();
      removeAllSubscriptions();

      try {
        manager.destroy();
      } catch {
        // ignore
      }

      managerRef.current = null;
    };
  }, [autoScanOnBluetoothOn, requestPermissions, scanDevices, stopScan, removeAllSubscriptions]);

  return {
    devices,
    connectedDevice,
    connectionState,
    measurementData,
    logs,
    scanDevices,
    connectToDevice,
    disconnect
  };
}
