import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  BloodPressureMeasurement,
  OmronDiscoveredDevice,
  OmronMeasurement,
  useOmronBluetooth,
  WeightMeasurement
} from '@/hooks/useOmron';

// Simulator mode - generates mock data since BLE doesn't work in simulator
const useSimulatorMode = () => {
  const [devices, setDevices] = useState<OmronDiscoveredDevice[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<OmronDiscoveredDevice | null>(null);
  const [connectionState, setConnectionState] = useState('Disconnected');
  const [measurementData, setMeasurementData] = useState<OmronMeasurement[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-19), `[${ts}] ${msg}`]);
  };

  const scanDevices = () => {
    addLog('Starting simulated scan...');
    setDevices([]);

    setTimeout(() => {
      const mockDevices: OmronDiscoveredDevice[] = [
        {
          id: 'mock-bp-001',
          name: 'OMRON BP Monitor',
          pairable: true,
          timeNotConfigured: false,
          numberOfUsers: 2,
          users: [
            { index: 1, lastSequenceNumber: 5, numberOfRecords: 3 },
            { index: 2, lastSequenceNumber: 2, numberOfRecords: 1 }
          ]
        } as OmronDiscoveredDevice,
        {
          id: 'mock-scale-002',
          name: 'OMRON Body Scale',
          pairable: true,
          timeNotConfigured: true,
          numberOfUsers: 1,
          users: [{ index: 1, lastSequenceNumber: 10, numberOfRecords: 5 }]
        } as OmronDiscoveredDevice
      ];

      mockDevices.forEach(d => addLog(`Found: ${d.name}`));
      setDevices(mockDevices);
      addLog('Scan complete');
    }, 1500);
  };

  const connectToDevice = async (device: OmronDiscoveredDevice) => {
    setConnectionState('Connecting...');
    addLog(`Connecting to ${device.name}...`);

    setTimeout(() => {
      setConnectedDevice(device);
      setConnectionState('Connected');
      addLog(`Connected to ${device.name}`);
      addLog('Services discovered');

      // Simulate receiving measurements
      setTimeout(() => {
        const mockMeasurements: OmronMeasurement[] = device.name?.includes('BP')
          ? [
              {
                type: 'blood_pressure',
                systolic: 120,
                diastolic: 80,
                meanArterialPressure: 93,
                pulse: 72,
                timestamp: new Date(),
                unit: 'mmHg'
              } as BloodPressureMeasurement,
              {
                type: 'blood_pressure',
                systolic: 118,
                diastolic: 78,
                meanArterialPressure: 91,
                pulse: 68,
                timestamp: new Date(Date.now() - 86400000),
                unit: 'mmHg'
              } as BloodPressureMeasurement
            ]
          : [
              {
                type: 'weight',
                weight: 72.5,
                timestamp: new Date(),
                unit: 'kg'
              } as WeightMeasurement
            ];

        mockMeasurements.forEach(m => {
          addLog(`Received: ${JSON.stringify(m)}`);
        });
        setMeasurementData(mockMeasurements);
      }, 1000);
    }, 1500);
  };

  const disconnect = async () => {
    setConnectedDevice(null);
    setConnectionState('Disconnected');
    setMeasurementData([]);
    addLog('Disconnected');
  };

  return { devices, connectedDevice, connectionState, measurementData, logs, scanDevices, connectToDevice, disconnect };
};

// Component that uses real BLE - only rendered when simulator mode is off
function RealModeContent({ onSwitchToSim }: { onSwitchToSim: () => void }) {
  const { devices, connectedDevice, connectionState, measurementData, logs, scanDevices, connectToDevice, disconnect } =
    useOmronBluetooth({ autoScanOnBluetoothOn: false });

  return (
    <DemoContent
      devices={devices}
      connectedDevice={connectedDevice}
      connectionState={connectionState}
      measurementData={measurementData}
      logs={logs}
      scanDevices={scanDevices}
      connectToDevice={connectToDevice}
      disconnect={disconnect}
      isSimulator={false}
      onToggleMode={onSwitchToSim}
    />
  );
}

// Component that uses simulator - safe to use anywhere
function SimModeContent({ onSwitchToReal }: { onSwitchToReal: () => void }) {
  const { devices, connectedDevice, connectionState, measurementData, logs, scanDevices, connectToDevice, disconnect } =
    useSimulatorMode();

  return (
    <DemoContent
      devices={devices}
      connectedDevice={connectedDevice}
      connectionState={connectionState}
      measurementData={measurementData}
      logs={logs}
      scanDevices={scanDevices}
      connectToDevice={connectToDevice}
      disconnect={disconnect}
      isSimulator={true}
      onToggleMode={onSwitchToReal}
    />
  );
}

export default function HomeScreen() {
  const [simulatorMode, setSimulatorMode] = useState(true);

  if (simulatorMode) {
    return <SimModeContent onSwitchToReal={() => setSimulatorMode(false)} />;
  }

  return <RealModeContent onSwitchToSim={() => setSimulatorMode(true)} />;
}

type DemoContentProps = {
  devices: OmronDiscoveredDevice[];
  connectedDevice: any;
  connectionState: string;
  measurementData: OmronMeasurement[];
  logs: string[];
  scanDevices: () => void;
  connectToDevice: (device: OmronDiscoveredDevice) => void;
  disconnect: () => void;
  isSimulator: boolean;
  onToggleMode: () => void;
};

function DemoContent({
  devices,
  connectedDevice,
  connectionState,
  measurementData,
  logs,
  scanDevices,
  connectToDevice,
  disconnect,
  isSimulator,
  onToggleMode
}: DemoContentProps) {

  const renderMeasurement = (m: OmronMeasurement, i: number) => {
    if (m.type === 'blood_pressure') {
      return (
        <View key={i} style={styles.measurementCard}>
          <Text style={styles.measurementType}>Blood Pressure</Text>
          <Text style={styles.measurementValue}>
            {m.systolic}/{m.diastolic} {m.unit}
          </Text>
          {m.pulse && <Text style={styles.measurementDetail}>Pulse: {m.pulse} bpm</Text>}
          <Text style={styles.measurementTime}>{m.timestamp.toLocaleString()}</Text>
        </View>
      );
    }
    if (m.type === 'weight') {
      return (
        <View key={i} style={styles.measurementCard}>
          <Text style={styles.measurementType}>Weight</Text>
          <Text style={styles.measurementValue}>
            {m.weight.toFixed(1)} {m.unit}
          </Text>
          <Text style={styles.measurementTime}>{m.timestamp.toLocaleString()}</Text>
        </View>
      );
    }
    if (m.type === 'temperature') {
      return (
        <View key={i} style={styles.measurementCard}>
          <Text style={styles.measurementType}>Temperature</Text>
          <Text style={styles.measurementValue}>
            {m.temperature.toFixed(1)} {m.unit}
          </Text>
          <Text style={styles.measurementTime}>{m.timestamp.toLocaleString()}</Text>
        </View>
      );
    }
    if (m.type === 'body_composition') {
      return (
        <View key={i} style={styles.measurementCard}>
          <Text style={styles.measurementType}>Body Composition</Text>
          {m.bodyFatPercentage && <Text style={styles.measurementDetail}>Body Fat: {m.bodyFatPercentage}%</Text>}
          {m.muscleMass && <Text style={styles.measurementDetail}>Muscle: {m.muscleMass} kg</Text>}
          <Text style={styles.measurementTime}>{m.timestamp.toLocaleString()}</Text>
        </View>
      );
    }
    return null;
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Omron BLE Demo</Text>

      <Pressable style={styles.toggleRow} onPress={onToggleMode}>
        <Text style={[styles.modeBadge, isSimulator ? styles.simBadge : styles.realBadge]}>
          {isSimulator ? '🧪 Simulator Mode' : '📡 Real BLE Mode'}
        </Text>
        <Text style={styles.toggleHint}>Tap to switch</Text>
      </Pressable>

      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Status:</Text>
        <Text style={[styles.statusValue, connectionState === 'Connected' && styles.statusConnected]}>
          {connectionState}
        </Text>
      </View>

      <View style={styles.buttonRow}>
        {!connectedDevice ? (
          <Pressable style={styles.button} onPress={scanDevices}>
            <Text style={styles.buttonText}>Scan Devices</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.button, styles.buttonDanger]} onPress={disconnect}>
            <Text style={styles.buttonText}>Disconnect</Text>
          </Pressable>
        )}
      </View>

      {devices.length > 0 && !connectedDevice && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Discovered Devices</Text>
          {devices.map(device => (
            <Pressable
              key={device.id}
              style={styles.deviceCard}
              onPress={() => connectToDevice(device as OmronDiscoveredDevice)}>
              <Text style={styles.deviceName}>{device.name || 'Unknown'}</Text>
              <Text style={styles.deviceInfo}>
                Users: {device.numberOfUsers} | Pairable: {device.pairable ? 'Yes' : 'No'}
              </Text>
              {device.users.map((u, i) => (
                <Text key={i} style={styles.deviceUser}>
                  User {u.index}: {u.numberOfRecords} records
                </Text>
              ))}
            </Pressable>
          ))}
        </View>
      )}

      {measurementData.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Measurements</Text>
          {measurementData.map(renderMeasurement)}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Logs</Text>
        <View style={styles.logContainer}>
          {logs.length === 0 ? (
            <Text style={styles.logEmpty}>No logs yet</Text>
          ) : (
            logs.map((log, i) => (
              <Text key={i} style={styles.logEntry}>
                {log}
              </Text>
            ))
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5'
  },
  content: {
    padding: 16,
    paddingTop: 60
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    gap: 12
  },
  toggleLabel: {
    fontSize: 16
  },
  modeBadge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    fontSize: 14,
    fontWeight: '600',
    overflow: 'hidden'
  },
  simBadge: {
    backgroundColor: '#f59e0b',
    color: '#fff'
  },
  realBadge: {
    backgroundColor: '#22c55e',
    color: '#fff'
  },
  toggleHint: {
    fontSize: 12,
    color: '#999'
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    gap: 8
  },
  statusLabel: {
    fontSize: 16,
    fontWeight: '600'
  },
  statusValue: {
    fontSize: 16,
    color: '#666'
  },
  statusConnected: {
    color: '#22c55e',
    fontWeight: '600'
  },
  buttonRow: {
    alignItems: 'center',
    marginBottom: 20
  },
  button: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8
  },
  buttonDanger: {
    backgroundColor: '#ef4444'
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600'
  },
  section: {
    marginBottom: 20
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12
  },
  deviceCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4
  },
  deviceInfo: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4
  },
  deviceUser: {
    fontSize: 12,
    color: '#888'
  },
  measurementCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2
  },
  measurementType: {
    fontSize: 14,
    color: '#3b82f6',
    fontWeight: '600',
    marginBottom: 4
  },
  measurementValue: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4
  },
  measurementDetail: {
    fontSize: 14,
    color: '#666'
  },
  measurementTime: {
    fontSize: 12,
    color: '#999',
    marginTop: 4
  },
  logContainer: {
    backgroundColor: '#1e1e1e',
    padding: 12,
    borderRadius: 8,
    maxHeight: 200
  },
  logEmpty: {
    color: '#666',
    fontStyle: 'italic'
  },
  logEntry: {
    color: '#4ade80',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 2
  }
});
