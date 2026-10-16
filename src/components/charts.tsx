import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { barChart, lineChart, type LinePoint } from '@/engine/svg-charts';
import { useTheme } from '@/hooks/use-theme';

function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  return [width, (e) => setWidth(Math.round(e.nativeEvent.layout.width))];
}

/** Mood over time (levels 1–5), paths from src/engine/svg-charts.ts (D27). */
export function MoodLineChart({ points, xMax, breakGaps, color, testID, summary }: { points: LinePoint[]; xMax: number; breakGaps: boolean; color: string; testID?: string; summary: string }) {
  const theme = useTheme();
  const [width, onLayout] = useWidth();
  const height = 140;
  const box = { width, height, padLeft: 6, padRight: 6, padTop: 8, padBottom: 8 };
  const chart = width > 0 ? lineChart(points, xMax, box, breakGaps) : null;
  return (
    <View testID={testID} onLayout={onLayout} accessible accessibilityLabel={summary} style={{ height }}>
      {chart ? (
        <Svg width={width} height={height}>
          {chart.levelLines.map((l) => (
            <Line key={l.level} x1={0} x2={width} y1={l.y} y2={l.y} stroke={theme.border} strokeWidth={0.5} />
          ))}
          {chart.segments.map((d, i) => (
            <Path key={i} d={d} stroke={color} strokeWidth={2} fill="none" />
          ))}
          {chart.dots.length <= 120 ? chart.dots.map((d, i) => <Circle key={i} cx={d.cx} cy={d.cy} r={2.5} fill={color} />) : null}
        </Svg>
      ) : null}
    </View>
  );
}

/** Bars of level means with labels underneath (by weekday, by month). */
export function LevelBars({ values, labels, colorFor, testID, summary }: { values: (number | null)[]; labels: string[]; colorFor: (v: number) => string; testID?: string; summary: string }) {
  const theme = useTheme();
  const [width, onLayout] = useWidth();
  const height = 110;
  const box = { width, height, padLeft: 2, padRight: 2, padTop: 6, padBottom: 2 };
  const bars = width > 0 ? barChart(values, box) : [];
  return (
    <View testID={testID} accessible accessibilityLabel={summary}>
      <View onLayout={onLayout} style={{ height }}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            {bars.map((b, i) => (b.value === null ? null : <Rect key={i} x={b.x} y={b.y} width={b.width} height={b.height} rx={3} fill={colorFor(b.value)} />))}
          </Svg>
        ) : null}
      </View>
      <View style={styles.labels}>
        {labels.map((l, i) => (
          <Text key={i} style={[styles.label, { color: theme.textSecondary }]} numberOfLines={1}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labels: { flexDirection: 'row' },
  label: { flex: 1, textAlign: 'center', fontSize: 11 },
});
