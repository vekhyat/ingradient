import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useState } from 'react';

import { NavBar, type RootTab } from '../../components/NavBar';
import { useServices } from '../../features/app/services';
import { DiscardLabelSheet } from '../../features/scan/DiscardLabelSheet';
import { leaveScanDecision } from '../../features/scan/leave-guard';
import { useColors } from '../../theme/ThemeProvider';

const ROUTE_FOR: Record<RootTab, string> = {
  scan: 'index',
  history: 'history',
  you: 'you',
};

const TAB_FOR: Record<string, RootTab> = {
  index: 'scan',
  history: 'history',
  you: 'you',
};

export default function TabsLayout() {
  const colors = useColors();
  const { noticeAccepted, label } = useServices();
  // The tab change waiting on the discard question, if any.
  const [pending, setPending] = useState<null | (() => void)>(null);

  // ONB-01: the notice comes before any analysis can run.
  if (noticeAccepted === false) {
    return <Redirect href="/onboarding" />;
  }

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.bg },
        }}
        tabBar={({ state, navigation }) => {
          const current =
            TAB_FOR[state.routes[state.index]?.name ?? 'index'] ?? 'scan';
          return (
            <NavBar
              current={current}
              onSelect={(next) => {
                const name = ROUTE_FOR[next];
                const route = state.routes.find((item) => item.name === name);
                const go = () => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route?.key,
                    canPreventDefault: true,
                  });
                  if (!event.defaultPrevented) {
                    navigation.navigate(name);
                  }
                };
                if (
                  leaveScanDecision(current, next, label.isDirty()) === 'ask'
                ) {
                  setPending(() => go);
                  return;
                }
                go();
              }}
            />
          );
        }}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="history" />
        <Tabs.Screen name="you" />
      </Tabs>
      <DiscardLabelSheet
        visible={pending !== null}
        onKeep={() => setPending(null)}
        onDiscard={() => {
          const go = pending;
          setPending(null);
          label.discard();
          go?.();
        }}
      />
    </>
  );
}
