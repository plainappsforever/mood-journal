import { NativeModule, requireOptionalNativeModule } from 'expo';

// Android "Mood" home-screen widget (V1_PLAN P9, D20; Breathe start-widget structure). The app pushes a JSON
// snapshot (src/lib/widgets.ts); the widget draws five faces (each opens `<scheme>://new?mood=<level>`), today's
// colour and the streak line, and redraws itself at the next journal-day start (non-waking alarm).
declare class MoodWidgetModule extends NativeModule {
  /** Stores the snapshot (JSON of AndroidWidgetData) and redraws placed widgets. */
  setData(json: string): void;
  widgetCount(): number;
  /** "requested" (the launcher shows its dialog), "alreadyAdded" or "unsupported". */
  requestPinWidget(): 'requested' | 'alreadyAdded' | 'unsupported';
}

/** Android only; null on iOS and in tests. */
export default requireOptionalNativeModule<MoodWidgetModule>('MoodWidget');
