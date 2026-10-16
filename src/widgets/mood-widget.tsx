/**
 * P9 (iOS only): the SwiftUI layout of the "Mood" widget (home screen small/medium, Lock Screen circular/rectangular)
 * with expo-widgets + @expo/ui (D20, eye-app D67 pattern). The `'widget'` function is turned into a string at build
 * time and runs inside the widget extension, where every @expo/ui/swift-ui component and modifier is a global: it may
 * use only its arguments and those globals (no other imports, no module constants). Props come from the pure
 * builder in src/lib/widget-data.ts. Import this file only through src/lib/widgets.ts (iOS, lazily).
 */
import { Circle, HStack, Link, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame, lineLimit, minimumScaleFactor, padding, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

import type { MoodWidgetProps } from '@/lib/widget-data';

/** Must match the widget `name` in the expo-widgets plugin config (app.config.ts). */
export const MOOD_WIDGET = 'MoodWidget';

function MoodWidgetLayout(props: MoodWidgetProps, environment: WidgetEnvironment) {
  'widget';
  const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
  const family = environment.widgetFamily;
  const face = (f: MoodWidgetProps['faces'][number], size: number) => (
    <ZStack>
      <Circle modifiers={[foregroundStyle(f.color), frame({ width: size, height: size })]} />
      <Text modifiers={[font({ size: size * 0.55 })]}>{f.emoji}</Text>
    </ZStack>
  );

  if (family === 'accessoryCircular') {
    return (
      <VStack spacing={0} modifiers={[widgetURL(props.logUrl)]}>
        <Text modifiers={[font({ size: 20 })]}>{props.locked || !props.streakShort ? '🙂' : '🔥'}</Text>
        {props.streakShort ? <Text modifiers={[font({ size: 14, weight: 'semibold' })]}>{props.streakShort}</Text> : null}
      </VStack>
    );
  }
  if (family === 'accessoryRectangular' || family === 'accessoryInline') {
    return (
      <VStack alignment="leading" spacing={2} modifiers={[widgetURL(props.logUrl)]}>
        <Text modifiers={[font({ size: 15, weight: 'semibold' }), lineLimit(1)]}>{props.title}</Text>
        <Text modifiers={[font({ size: 13 }), lineLimit(1), minimumScaleFactor(0.7)]}>{props.locked ? props.logLabel : props.streakText}</Text>
      </VStack>
    );
  }
  if (family === 'systemMedium') {
    return (
      <VStack alignment="leading" spacing={8}>
        <Text modifiers={[font({ size: 15, weight: 'semibold' })]}>{props.title}</Text>
        <HStack spacing={6}>
          {props.faces.map((f) => (
            <Link key={f.level} destination={f.url}>
              {face(f, 46)}
            </Link>
          ))}
        </HStack>
        {props.locked ? null : (
          <Text modifiers={[font({ size: 13 }), secondary, lineLimit(1), minimumScaleFactor(0.7)]}>{props.streakText}</Text>
        )}
      </VStack>
    );
  }
  // systemSmall (and anything else): today's colour, the streak, "Log" — one tap opens a new entry.
  return (
    <VStack alignment="leading" spacing={6} modifiers={[widgetURL(props.logUrl)]}>
      <Text modifiers={[font({ size: 14, weight: 'semibold' }), lineLimit(1)]}>{props.title}</Text>
      {props.locked ? (
        <HStack spacing={2}>
          {props.faces.map((f) => (
            <Text key={f.level} modifiers={[font({ size: 18 })]}>
              {f.emoji}
            </Text>
          ))}
        </HStack>
      ) : (
        <HStack spacing={8}>
          <Circle modifiers={[foregroundStyle(props.todayColor ?? '#8E8E9380'), frame({ width: 34, height: 34 })]} />
          <Text modifiers={[font({ size: 12 }), secondary, lineLimit(2), minimumScaleFactor(0.7)]}>{props.todayText}</Text>
        </HStack>
      )}
      {props.locked ? null : <Text modifiers={[font({ size: 12 }), lineLimit(2), minimumScaleFactor(0.7)]}>{props.streakText}</Text>}
      <Spacer />
      <Text modifiers={[font({ size: 14, weight: 'semibold' }), foregroundStyle('#208AEF'), padding({ top: 0 })]}>{`＋ ${props.logLabel}`}</Text>
    </VStack>
  );
}

export const MoodWidget = createWidget<MoodWidgetProps>(MOOD_WIDGET, MoodWidgetLayout);
