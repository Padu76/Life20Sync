// E:\Life20Sync\src\SyncScreen.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Platform, ScrollView,
  SafeAreaView, TextInput,
} from 'react-native';
import Config from 'react-native-config';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AppleHealthKit from 'react-native-health';

// ---------------------------------------------------------------------------
// Environment-based configuration (moved out of source code into .env)
// ---------------------------------------------------------------------------
const SUPABASE_URL = Config.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = Config.SUPABASE_ANON_KEY ?? '';
const API_BASE = Config.API_BASE ?? '';

// ---------------------------------------------------------------------------
// AsyncStorage keys
// ---------------------------------------------------------------------------
const STORAGE_KEY_ACCESS = '@life20sync_access_token';
const STORAGE_KEY_REFRESH = '@life20sync_refresh_token';
const STORAGE_KEY_EXPIRES = '@life20sync_token_expires_at';

// ---------------------------------------------------------------------------
// HealthKit permissions
// ---------------------------------------------------------------------------
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
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // On mount: request HealthKit permissions & restore persisted session
  // -----------------------------------------------------------------------
  useEffect(() => {
    requestHealthPermissions();
    restoreSession();
  }, []);

  useEffect(() => {
    if (hasPermission && token) {
      autoSync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission, token]);

  // -----------------------------------------------------------------------
  // Token persistence helpers (Critical Fix 2)
  // -----------------------------------------------------------------------
  const persistSession = async (
    accessToken: string,
    refresh: string,
    expiresIn: number,
  ) => {
    const expiresAt = Date.now() + expiresIn * 1000;
    try {
      await AsyncStorage.multiSet([
        [STORAGE_KEY_ACCESS, accessToken],
        [STORAGE_KEY_REFRESH, refresh],
        [STORAGE_KEY_EXPIRES, String(expiresAt)],
      ]);
    } catch (e) {
      console.error('Errore salvataggio sessione', e);
    }
    setToken(accessToken);
    setRefreshToken(refresh);
    setTokenExpiresAt(expiresAt);
  };

  const restoreSession = async () => {
    try {
      const values = await AsyncStorage.multiGet([
        STORAGE_KEY_ACCESS,
        STORAGE_KEY_REFRESH,
        STORAGE_KEY_EXPIRES,
      ]);
      const storedAccess = values[0][1];
      const storedRefresh = values[1][1];
      const storedExpires = values[2][1];

      if (storedAccess && storedRefresh && storedExpires) {
        const expiresAt = Number(storedExpires);
        if (Date.now() < expiresAt) {
          // Token still valid
          setToken(storedAccess);
          setRefreshToken(storedRefresh);
          setTokenExpiresAt(expiresAt);
          setSyncStatus('Sessione ripristinata');
        } else {
          // Token expired -- try to refresh
          const refreshed = await doRefreshToken(storedRefresh);
          if (!refreshed) {
            await clearSession();
          }
        }
      }
    } catch (e) {
      console.error('Errore ripristino sessione', e);
    }
  };

  const clearSession = async () => {
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEY_ACCESS,
        STORAGE_KEY_REFRESH,
        STORAGE_KEY_EXPIRES,
      ]);
    } catch (e) {
      console.error('Errore pulizia sessione', e);
    }
    setToken(null);
    setRefreshToken(null);
    setTokenExpiresAt(null);
    setSyncStatus('');
    setStepsData([]);
    setTotalSteps(0);
  };

  // -----------------------------------------------------------------------
  // Token refresh (Critical Fix 3)
  // -----------------------------------------------------------------------
  const doRefreshToken = async (rToken: string): Promise<boolean> => {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ refresh_token: rToken }),
        },
      );
      const data = await res.json();
      if (data.access_token && data.refresh_token) {
        await persistSession(
          data.access_token,
          data.refresh_token,
          data.expires_in ?? 3600,
        );
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  /**
   * Ensures the current access token is still valid.
   * If it is about to expire (within 60 s) or already expired, it refreshes.
   * Returns a valid access token or null if refresh failed.
   */
  const ensureValidToken = useCallback(async (): Promise<string | null> => {
    if (!token || !refreshToken || !tokenExpiresAt) return null;

    // Refresh if token expires within the next 60 seconds
    if (Date.now() > tokenExpiresAt - 60_000) {
      const ok = await doRefreshToken(refreshToken);
      if (!ok) {
        await clearSession();
        Alert.alert('Sessione scaduta', 'Effettua nuovamente il login');
        return null;
      }
      // After refresh, the state will have been updated by persistSession.
      // Read the fresh value from AsyncStorage to be safe in the same tick.
      const freshToken = await AsyncStorage.getItem(STORAGE_KEY_ACCESS);
      return freshToken;
    }

    return token;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, refreshToken, tokenExpiresAt]);

  // -----------------------------------------------------------------------
  // HealthKit permissions
  // -----------------------------------------------------------------------
  const requestHealthPermissions = () => {
    if (Platform.OS !== 'ios') {
      Alert.alert('Errore', 'Apple Health disponibile solo su iOS');
      return;
    }
    AppleHealthKit.initHealthKit(permissions, (error: string | null) => {
      if (error) {
        setSyncStatus('Errore permessi HealthKit');
        return;
      }
      setHasPermission(true);
      setSyncStatus('Permessi concessi!');
    });
  };

  // -----------------------------------------------------------------------
  // Login
  // -----------------------------------------------------------------------
  const login = async () => {
    if (!email || !password) {
      Alert.alert('Errore', 'Inserisci email e password');
      return;
    }
    setLoginLoading(true);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ email, password }),
        },
      );
      const data = await res.json();
      if (data.access_token) {
        await persistSession(
          data.access_token,
          data.refresh_token ?? '',
          data.expires_in ?? 3600,
        );
        setSyncStatus('Login effettuato!');
      } else {
        Alert.alert(
          'Errore Login',
          data.error_description || 'Credenziali non valide',
        );
      }
    } catch (e: any) {
      Alert.alert('Errore', e.message);
    } finally {
      setLoginLoading(false);
    }
  };

  // -----------------------------------------------------------------------
  // HealthKit data
  // -----------------------------------------------------------------------
  const getLast30DaysSteps = (): Promise<Array<{ date: string; steps: number }>> => {
    return new Promise((resolve) => {
      const results: Array<{ date: string; steps: number }> = [];
      let completed = 0;
      const totalDays = 30;

      for (let i = 0; i < totalDays; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);

        AppleHealthKit.getStepCount(
          { date: date.toISOString(), includeManuallyAdded: true },
          (err: string | null, stepResult: { value: number } | null) => {
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
          },
        );
      }
    });
  };

  // -----------------------------------------------------------------------
  // Sync to backend (with 401 retry via token refresh -- Critical Fix 3)
  // -----------------------------------------------------------------------
  const syncToSupabase = async (
    data: Array<{ date: string; steps: number }>,
  ) => {
    const validToken = await ensureValidToken();
    if (!validToken) return 0;

    let synced = 0;
    for (const day of data) {
      try {
        let res = await fetch(`${API_BASE}/api/mobile/steps`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${validToken}`,
          },
          body: JSON.stringify({
            date: day.date,
            steps: day.steps,
            source: 'apple-health',
          }),
        });

        // Handle 401 by refreshing token and retrying once
        if (res.status === 401 && refreshToken) {
          const refreshed = await doRefreshToken(refreshToken);
          if (refreshed) {
            const newToken = await AsyncStorage.getItem(STORAGE_KEY_ACCESS);
            if (newToken) {
              res = await fetch(`${API_BASE}/api/mobile/steps`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${newToken}`,
                },
                body: JSON.stringify({
                  date: day.date,
                  steps: day.steps,
                  source: 'apple-health',
                }),
              });
            }
          } else {
            await clearSession();
            Alert.alert('Sessione scaduta', 'Effettua nuovamente il login');
            return synced;
          }
        }

        if (res.ok) synced++;
      } catch (e) {
        console.error('Sync error for', day.date, e);
      }
    }
    return synced;
  };

  // -----------------------------------------------------------------------
  // Auto / manual sync
  // -----------------------------------------------------------------------
  const autoSync = async () => {
    if (!hasPermission || !token) return;
    setSyncing(true);
    setSyncStatus('Sync automatica in corso...');
    try {
      const data = await getLast30DaysSteps();
      const synced = await syncToSupabase(data);
      const total = data.reduce((s, d) => s + d.steps, 0);
      setStepsData(data.slice(0, 7));
      setTotalSteps(total);
      const now = new Date().toLocaleTimeString('it-IT');
      setLastSyncTime(now);
      setSyncStatus(`Sincronizzati ${synced} giorni alle ${now}`);
    } catch (e: any) {
      setSyncStatus('Errore sync: ' + e.message);
    } finally {
      setSyncing(false);
    }
  };

  const manualSync = async () => {
    if (!hasPermission) {
      requestHealthPermissions();
      return;
    }
    if (!token) {
      Alert.alert('Login richiesto', 'Effettua il login prima');
      return;
    }
    setLoading(true);
    setSyncStatus('Lettura da Apple Health...');
    try {
      const data = await getLast30DaysSteps();
      setSyncStatus('Invio dati a Sfida30...');
      const synced = await syncToSupabase(data);
      const total = data.reduce((s, d) => s + d.steps, 0);
      setStepsData(data.slice(0, 7));
      setTotalSteps(total);
      const now = new Date().toLocaleTimeString('it-IT');
      setLastSyncTime(now);
      setSyncStatus(`Sincronizzati ${synced} giorni alle ${now}`);
      Alert.alert(
        'Sync Completata!',
        `${synced} giorni inviati a Sfida30\nTotale 30gg: ${total.toLocaleString('it-IT')} passi`,
      );
    } catch (e: any) {
      setSyncStatus('Errore: ' + e.message);
      Alert.alert('Errore', e.message);
    } finally {
      setLoading(false);
    }
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          <Text style={styles.title}>Life20 Sync</Text>
          <Text style={styles.subtitle}>Apple Health &rarr; Sfida30</Text>

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
                {loginLoading ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={styles.buttonText}>Accedi</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.loggedBox}>
                <Text style={styles.loggedText}>Connesso a Sfida30</Text>
                {lastSyncTime && (
                  <Text style={styles.lastSync}>
                    Ultima sync: {lastSyncTime}
                  </Text>
                )}
              </View>

              {totalSteps > 0 && (
                <View style={styles.infoBox}>
                  <Text style={styles.infoLabel}>
                    Passi totali (30 giorni):
                  </Text>
                  <Text style={styles.infoValue}>
                    {totalSteps.toLocaleString('it-IT')}
                  </Text>
                </View>
              )}

              {stepsData.length > 0 && (
                <View style={styles.dataBox}>
                  <Text style={styles.dataTitle}>Ultimi 7 giorni:</Text>
                  {stepsData.map((day) => (
                    <View key={day.date} style={styles.dayRow}>
                      <Text style={styles.dayDate}>{day.date}</Text>
                      <Text
                        style={[
                          styles.daySteps,
                          day.steps >= 8333 && styles.dayStepsGood,
                        ]}
                      >
                        {day.steps.toLocaleString('it-IT')} passi
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              <TouchableOpacity
                style={[
                  styles.button,
                  (loading || syncing) && styles.buttonDisabled,
                ]}
                onPress={manualSync}
                disabled={loading || syncing}
              >
                {loading || syncing ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={styles.buttonText}>
                    Sincronizza con Sfida30
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.buttonSecondary]}
                onPress={clearSession}
              >
                <Text style={styles.buttonText}>Logout</Text>
              </TouchableOpacity>
            </>
          )}

          <Text style={styles.note}>Life20Sync &middot; Sfida30</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  scrollView: { flex: 1 },
  content: { padding: 20 },
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
    marginBottom: 24,
  },
  statusBox: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#000',
  },
  statusText: { fontSize: 14, color: '#333', textAlign: 'center' },
  loginBox: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#000',
    marginBottom: 16,
  },
  loginTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 16,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderWidth: 2,
    borderColor: '#000',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    fontSize: 16,
    color: '#000',
  },
  loggedBox: {
    backgroundColor: '#e8fff5',
    padding: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#00CC7E',
    marginBottom: 16,
  },
  loggedText: {
    fontSize: 14,
    color: '#00CC7E',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  lastSync: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginTop: 4,
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
  infoValue: { fontSize: 28, fontWeight: 'bold', color: '#000' },
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
  dayDate: { fontSize: 14, color: '#666' },
  daySteps: { fontSize: 14, fontWeight: '600', color: '#999' },
  dayStepsGood: { color: '#00CC7E' },
  button: {
    backgroundColor: '#00FF9D',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#000',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonSecondary: { backgroundColor: '#fff' },
  buttonText: { fontSize: 16, fontWeight: 'bold', color: '#000' },
  note: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
});
