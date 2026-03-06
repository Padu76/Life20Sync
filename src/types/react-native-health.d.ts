/**
 * Type declarations for react-native-health.
 *
 * The library does not ship its own TypeScript definitions and
 * DefinitelyTyped does not have @types/react-native-health either,
 * so we provide a minimal ambient module declaration here.
 */
declare module 'react-native-health' {
  interface HealthKitPermissions {
    permissions: {
      read: string[];
      write: string[];
    };
  }

  interface StepCountOptions {
    date: string;
    includeManuallyAdded?: boolean;
  }

  interface StepCountResult {
    value: number;
  }

  const AppleHealthKit: {
    initHealthKit(
      permissions: HealthKitPermissions,
      callback: (error: string | null) => void,
    ): void;
    getStepCount(
      options: StepCountOptions,
      callback: (error: string | null, result: StepCountResult | null) => void,
    ): void;
  };

  export default AppleHealthKit;
}
