// E:\Life20Sync\src\SyncScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  SafeAreaView,
} from 'react-native';

// @ts-ignore
import AppleHealthKit from 'react-native-health';

const permissions = {
  permissions: {
    read: ['Steps'],
    write: [],
  },
};

export default function SyncScreen() {
  const [loading, setLoading] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [stepsData, setStepsData] = useState<Array<{ date: string; steps: number }>>([]);
  const [totalSteps, setTotalSteps] = useState(0);
  const [syncStatus, setSyncStatus] = useState('');

  useEffect(() => {
    requestHealthPermissions();
  }, []);

  const requestHealthPermissions = () => {
    if (Platform.OS !== 'ios') {
      Alert.alert('Errore', 'Apple Health disponibile solo su iOS');
      return;
    }

    AppleHealthKit.initHealthKit(permissions, (error: string) => {
      if (error) {
        console.error('HealthKit error:', error);
        Alert.alert('Errore HealthKit', error);
        setSyncStatus('Errore permessi: ' + error);
        return;
      }
      
      setHasPermission(true);
      setSyncStatus('✅ Permessi concessi!');
      console.log('HealthKit authorized');
    });
  };

  const getLast7DaysSteps = (): Promise<Array<{ date: string; steps: number }>> => {
    return new Promise((resolve) => {
      const results: Array<{ date: string; steps: number }> = [];
      let completed = 0;
      const totalDays = 7;

      for (let i = 0; i < totalDays; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);

        const options = {
          date: date.toISOString(),
          includeManuallyAdded: true,
        };

        AppleHealthKit.getStepCount(options, (err: any, stepResult: any) => {
          completed++;

          if (!err && stepResult) {
            const dateStr = date.toISOString().split('T')[0];
            results.push({
              date: dateStr,
              steps: stepResult.value || 0,
            });
            console.log(`${dateStr}: ${stepResult.value || 0} steps`);
          }

          if (completed === totalDays) {
            results.sort((a, b) => b.date.localeCompare(a.date));
            resolve(results);
          }
        });
      }
    });
  };

  const readHealthData = async () => {
    if (!hasPermission) {
      Alert.alert('Permessi Mancanti', 'Concedi accesso ad Apple Health prima');
      requestHealthPermissions();
      return;
    }

    setLoading(true);
    setSyncStatus('📱 Lettura dati da Apple Health...');

    try {
      const data = await getLast7DaysSteps();
      setStepsData(data);
      
      const total = data.reduce((sum, day) => sum + day.steps, 0);
      setTotalSteps(total);
      
      setSyncStatus(`✅ Letti ${data.length} giorni - ${total.toLocaleString('it-IT')} passi totali`);
      
      console.log('Health data loaded:', data);
      
      Alert.alert(
        'Dati Letti!',
        `${total.toLocaleString('it-IT')} passi negli ultimi 7 giorni`
      );
    } catch (error: any) {
      console.error('Read error:', error);
      setSyncStatus('❌ Errore lettura: ' + error.message);
      Alert.alert('Errore', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          <Text style={styles.title}>Life20 Sync</Text>
          <Text style={styles.subtitle}>Apple Health Integration</Text>

          <View style={styles.statusBox}>
            <Text style={styles.statusText}>{syncStatus || 'Pronto per il test'}</Text>
          </View>

          {totalSteps > 0 && (
            <View style={styles.infoBox}>
              <Text style={styles.infoLabel}>Passi totali (7 giorni):</Text>
              <Text style={styles.infoValue}>
                {totalSteps.toLocaleString('it-IT')}
              </Text>
            </View>
          )}

          {stepsData.length > 0 && (
            <View style={styles.dataBox}>
              <Text style={styles.dataTitle}>Dettaglio Giornaliero:</Text>
              {stepsData.map((day) => (
                <View key={day.date} style={styles.dayRow}>
                  <Text style={styles.dayDate}>{day.date}</Text>
                  <Text style={styles.daySteps}>
                    {day.steps.toLocaleString('it-IT')} passi
                  </Text>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={readHealthData}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.buttonText}>
                📱 Leggi Passi da Apple Health
              </Text>
            )}
          </TouchableOpacity>

          {!hasPermission && (
            <TouchableOpacity
              style={[styles.button, styles.buttonSecondary]}
              onPress={requestHealthPermissions}
            >
              <Text style={styles.buttonText}>🔓 Concedi Permessi</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.note}>
            React Native CLI - Native HealthKit
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#000',
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 30,
  },
  statusBox: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#000',
  },
  statusText: {
    fontSize: 14,
    color: '#333',
    textAlign: 'center',
  },
  infoBox: {
    backgroundColor: '#00FF9D',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#000',
  },
  infoLabel: {
    fontSize: 14,
    color: '#000',
    marginBottom: 4,
    fontWeight: '600',
  },
  infoValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
  },
  dataBox: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#000',
  },
  dataTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 12,
  },
  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  dayDate: {
    fontSize: 14,
    color: '#666',
  },
  daySteps: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  button: {
    backgroundColor: '#00FF9D',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#000',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonSecondary: {
    backgroundColor: '#fff',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
  },
  note: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
});