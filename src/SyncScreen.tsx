// E:\Life20Sync\src\SyncScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Platform, ScrollView,
  SafeAreaView, TextInput,
} from 'react-native';

const SUPABASE_URL = 'https://vzwplpljxdqmdejvzwuw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6d3BscGxqeGRxbWRlanZ6d3V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0NDI2NDIsImV4cCI6MjA4NzAxODY0Mn0.qphtBWqokWxQR4bIXXROKZc7HpkFUEONNV0ykuev-20';
const API_BASE = 'https://sfida30.vercel.app';

// Import HealthKit SOLO se iPhone (non iPad, non Android)
// Su iPad HealthKit non esiste e crasha il TurboModule
let AppleHealthKit: any = null;
const IS_IPHONE = Platform.OS === 'ios' && !Platform.isPad;

if (IS_IPHONE) {
  try {
    AppleHealthKit = require('react-native-health').default;
  } catch (e) {
    console.warn('HealthKit not available:', e);
  }
}

const permissions = {
  permissions: { read: ['Steps'], write: [] },
};

export default function SyncScreen() {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [stepsData, setStepsData] = useState<Array<{ date: string; steps: number }>>([]);
  const [totalSteps, setTotalSteps] = useState(0);
  const [syncStatus, setSyncStatus] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  useEffect(() => {
    if (!IS_IPHONE) {
      setSyncStatus('⚠️ App disponibile solo su iPhone');
      return;
    }
    requestHealthPermissions();
  }, []);

  useEffect(() => {
    if (hasPermission && token) {
      autoSync();
    }
  }, [hasPermission, token]);

  const requestHealthPermissions = () => {
    if (!IS_IPHONE || !AppleHealthKit) {
      setSyncStatus('⚠️ HealthKit non disponibile su questo dispositivo');
      return;
    }
    try {
      AppleHealthKit.initHealthKit(permissions, (error: string) => {
        if (error) {
          setSyncStatus('❌ Errore permessi HealthKit');
          return;
        }
        setHasPermission(true);
        setSyncStatus('✅ Permessi concessi!');
      });
    } catch (e) {
      console.warn('initHealthKit error:', e);
      setSyncStatus('❌ HealthKit non disponibile');
    }
  };

  const login = async () => {
    if (!email || !password) {
      Alert.alert('Errore', 'Inserisci email e password');
      return;
    }
    setLoginLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.access_token) {
        setToken(data.access_token);
        setSyncStatus('✅ Login effettuato!');
      } else {
        Alert.alert('Errore Login', data.error_description || 'Credenziali non valide');
      }
    } catch (e: any) {
      Alert.alert('Errore', e.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const getLast30DaysSteps = (): Promise<Array<{ date: string; steps: number }>> => {
    return new Promise((resolve, reject) => {
      if (!AppleHealthKit) { reject(new Error('HealthKit non disponibile')); return; }
      const results: Array<{ date: string; steps: number }> = [];
      let completed = 0;
      const totalDays = 30;

      for (let i = 0; i < totalDays; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);

        try {
          AppleHealthKit.getStepCount(
            { date: date.toISOString(), includeManuallyAdded: true },
            (err: any, stepResult: any) => {
              completed++;
              if (!err && stepResult) {
                results.push({
                  date: date.toISOString().split('T')[0],
                  steps: stepResult.value || 0,
                });
              }
              if (completed === totalDays) {
                results.sort((a, b) => b.date.localeCompare(a.date));
                resolve(results);
              }
            }
          );
        } catch (e) {
          completed++;
          if (completed === totalDays) {
            results.sort((a, b) => b.date.localeCompare(a.date));
            resolve(results);
          }
        }
      }
    });
  };

  const syncToSupabase = async (data: Array<{ date: string; steps: number }>) => {
    if (!token) return 0;
    let synced = 0;
    for (const day of data) {
      try {
        const res = await fetch(`${API_BASE}/api/mobile/steps`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ date: day.date, steps: day.steps, source: 'apple-health' }),
        });
        if (res.ok) synced++;
      } catch (e) {
        console.error('Sync error for', day.date, e);
      }
    }
    return synced;
  };

  const autoSync = async () => {
    if (!hasPermission || !token) return;
    setSyncing(true);
    setSyncStatus('🔄 Sync automatica in corso...');
    try {
      const data = await getLast30DaysSteps();
      const synced = await syncToSupabase(data);
      const total = data.reduce((s, d) => s + d.steps, 0);
      setStepsData(data.slice(0, 7));
      setTotalSteps(total);
      const now = new Date().toLocaleTimeString('it-IT');
      setLastSyncTime(now);
      setSyncStatus(`✅ Sincronizzati ${synced} giorni alle ${now}`);
    } catch (e: any) {
      setSyncStatus('❌ Errore sync: ' + e.message);
    } finally {
      setSyncing(false);
    }
  };

  const manualSync = async () => {
    if (!hasPermission) { requestHealthPermissions(); return; }
    if (!token) { Alert.alert('Login richiesto', 'Effettua il login prima'); return; }
    setLoading(true);
    setSyncStatus('📱 Lettura da Apple Health...');
    try {
      const data = await getLast30DaysSteps();
      setSyncStatus('☁️ Invio dati a Sfida30...');
      const synced = await syncToSupabase(data);
      const total = data.reduce((s, d) => s + d.steps, 0);
      setStepsData(data.slice(0, 7));
      setTotalSteps(total);
      const now = new Date().toLocaleTimeString('it-IT');
      setLastSyncTime(now);
      setSyncStatus(`✅ Sincronizzati ${synced} giorni alle ${now}`);
      Alert.alert('Sync Completata!', `${synced} giorni inviati a Sfida30\nTotale 30gg: ${total.toLocaleString('it-IT')} passi`);
    } catch (e: any) {
      setSyncStatus('❌ Errore: ' + e.message);
      Alert.alert('Errore', e.message);
    } finally {
      setLoading(false);
    }
  };

  // Schermata se non è iPhone
  if (!IS_IPHONE) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.notSupportedContainer}>
          <Text style={styles.title}>Life20 Sync</Text>
          <Text style={styles.notSupportedIcon}>📱</Text>
          <Text style={styles.notSupportedTitle}>iPhone richiesto</Text>
          <Text style={styles.notSupportedText}>
            Life20 Sync utilizza Apple Health, disponibile solo su iPhone.{'\n\n'}
            Installa l'app sul tuo iPhone per sincronizzare i passi con Sfida30.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          <Text style={styles.title}>Life20 Sync</Text>
          <Text style={styles.subtitle}>Apple Health → Sfida30</Text>

          <View style={styles.statusBox}>
            <Text style={styles.statusText}>{syncStatus || 'Pronto'}</Text>
          </View>

          {!token ? (
            <View style={styles.loginBox}>
              <Text style={styles.loginTitle}>Login Sfida30</Text>
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor="#999"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#999"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
              <TouchableOpacity
                style={[styles.button, loginLoading && styles.buttonDisabled]}
                onPress={login}
                disabled={loginLoading}
              >
                {loginLoading
                  ? <ActivityIndicator color="#000" />
                  : <Text style={styles.buttonText}>🔐 Accedi</Text>
                }
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.loggedBox}>
                <Text style={styles.loggedText}>✅ Connesso a Sfida30</Text>
                {lastSyncTime && (
                  <Text style={styles.lastSync}>Ultima sync: {lastSyncTime}</Text>
                )}
              </View>

              {totalSteps > 0 && (
                <View style={styles.infoBox}>
                  <Text style={styles.infoLabel}>Passi totali (30 giorni):</Text>
                  <Text style={styles.infoValue}>{totalSteps.toLocaleString('it-IT')}</Text>
                </View>
              )}

              {stepsData.length > 0 && (
                <View style={styles.dataBox}>
                  <Text style={styles.dataTitle}>Ultimi 7 giorni:</Text>
                  {stepsData.map((day) => (
                    <View key={day.date} style={styles.dayRow}>
                      <Text style={styles.dayDate}>{day.date}</Text>
                      <Text style={[styles.daySteps, day.steps >= 8333 && styles.dayStepsGood]}>
                        {day.steps.toLocaleString('it-IT')} passi
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              <TouchableOpacity
                style={[styles.button, (loading || syncing) && styles.buttonDisabled]}
                onPress={manualSync}
                disabled={loading || syncing}
              >
                {loading || syncing
                  ? <ActivityIndicator color="#000" />
                  : <Text style={styles.buttonText}>🔄 Sincronizza con Sfida30</Text>
                }
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.buttonSecondary]}
                onPress={() => { setToken(null); setSyncStatus(''); setStepsData([]); setTotalSteps(0); }}
              >
                <Text style={styles.buttonText}>🚪 Logout</Text>
              </TouchableOpacity>
            </>
          )}

          <Text style={styles.note}>Life20Sync · Sfida30</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  scrollView: { flex: 1 },
  content: { padding: 20 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#000', textAlign: 'center', marginTop: 20, marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#666', textAlign: 'center', marginBottom: 24 },
  statusBox: { backgroundColor: '#fff', padding: 14, borderRadius: 12, marginBottom: 16, borderWidth: 2, borderColor: '#000' },
  statusText: { fontSize: 14, color: '#333', textAlign: 'center' },
  loginBox: { backgroundColor: '#fff', padding: 20, borderRadius: 12, borderWidth: 2, borderColor: '#000', marginBottom: 16 },
  loginTitle: { fontSize: 18, fontWeight: 'bold', color: '#000', marginBottom: 16, textAlign: 'center' },
  input: { backgroundColor: '#f5f5f5', borderWidth: 2, borderColor: '#000', borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 16, color: '#000' },
  loggedBox: { backgroundColor: '#e8fff5', padding: 14, borderRadius: 12, borderWidth: 2, borderColor: '#00CC7E', marginBottom: 16 },
  loggedText: { fontSize: 14, color: '#00CC7E', fontWeight: 'bold', textAlign: 'center' },
  lastSync: { fontSize: 12, color: '#666', textAlign: 'center', marginTop: 4 },
  infoBox: { backgroundColor: '#00FF9D', padding: 16, borderRadius: 12, marginBottom: 16, borderWidth: 2, borderColor: '#000' },
  infoLabel: { fontSize: 14, color: '#000', marginBottom: 4, fontWeight: '600' },
  infoValue: { fontSize: 28, fontWeight: 'bold', color: '#000' },
  dataBox: { backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 16, borderWidth: 2, borderColor: '#000' },
  dataTitle: { fontSize: 16, fontWeight: 'bold', color: '#000', marginBottom: 12 },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  dayDate: { fontSize: 14, color: '#666' },
  daySteps: { fontSize: 14, fontWeight: '600', color: '#999' },
  dayStepsGood: { color: '#00CC7E' },
  button: { backgroundColor: '#00FF9D', padding: 18, borderRadius: 12, alignItems: 'center', marginBottom: 12, borderWidth: 2, borderColor: '#000' },
  buttonDisabled: { opacity: 0.6 },
  buttonSecondary: { backgroundColor: '#fff' },
  buttonText: { fontSize: 16, fontWeight: 'bold', color: '#000' },
  note: { fontSize: 12, color: '#999', textAlign: 'center', marginTop: 20, marginBottom: 40 },
  notSupportedContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  notSupportedIcon: { fontSize: 64, marginBottom: 20 },
  notSupportedTitle: { fontSize: 24, fontWeight: 'bold', color: '#000', marginBottom: 16 },
  notSupportedText: { fontSize: 16, color: '#666', textAlign: 'center', lineHeight: 24 },
});
