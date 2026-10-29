import { memo, useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { displayHostOf } from "../../lib/url";
import { useActiveTabId, useTab } from "../../state/browser/hooks";
import { hideNewTabCard, openNewTabCard, useNewTabCards, type NewTabCard as Card } from "../../state/tabs/newTabCard";
import { Favicon } from "../favicon/Favicon";
import { Panel, radius, space, Text, useHover, useTheme, VisualEffect } from "../ui";
import { NEW_TAB_CARD, NEW_TAB_CARD_MOTION, SHADOWS, windowColors } from "./tokens";

export const NewTabCard = memo(function NewTabCard({ windowId, top }: { windowId: string; top: number }) {
  const card = useNewTabCards((s) => s.cards[windowId] ?? null);
  const appear = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState<Card | null>(card);

  const leave = (id: number) =>
    Animated.timing(appear, { toValue: 0, ...NEW_TAB_CARD_MOTION.out, useNativeDriver: true }).start(({ finished }) => {
      if (!finished) return;
      setShown(null);
      hideNewTabCard(windowId, id);
    });

  useEffect(() => {
    if (!card) {
      if (shown) leave(shown.id);
      return;
    }
    setShown(card);
    Animated.spring(appear, { toValue: 1, useNativeDriver: true, ...NEW_TAB_CARD_MOTION.in }).start();
    const timer = setTimeout(() => leave(card.id), NEW_TAB_CARD.holdMs);
    return () => clearTimeout(timer);
  }, [card?.id]);

  const watcher = card ? <HideWhenSeen windowId={windowId} card={card} /> : null;
  if (!shown) return watcher;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: top + NEW_TAB_CARD.inset, right: NEW_TAB_CARD.inset }}>
      {watcher}
      <Animated.View
        style={{
          opacity: appear,
          transform: [{ translateX: appear.interpolate({ inputRange: [0, 1], outputRange: [NEW_TAB_CARD.slide, 0] }) }],
        }}
      >
        <CardBody windowId={windowId} card={shown} />
      </Animated.View>
    </View>
  );
});

function HideWhenSeen({ windowId, card }: { windowId: string; card: Card }) {
  const activeId = useActiveTabId();
  const exists = useTab(card.tabId, (t) => !!t);
  useEffect(() => {
    if (!exists || activeId === card.tabId) hideNewTabCard(windowId, card.id);
  }, [card.id, exists, activeId]);
  return null;
}

function CardBody({ windowId, card }: { windowId: string; card: Card }) {
  const theme = useTheme();
  const colors = windowColors(theme.dark);
  const { hovered, hoverProps } = useHover();
  const url = useTab(card.tabId, (t) => t?.url ?? "");
  const title = useTab(card.tabId, (t) => t?.title || "");
  const favicon = useTab(card.tabId, (t) => t?.favicon ?? null);
  const profileId = useTab(card.tabId, (t) => t?.profileId);
  const heading = card.count > 1 ? `${card.count} new tabs created` : "New tab created";
  return (
    <Pressable {...hoverProps} onPress={() => openNewTabCard(windowId, card)}>
      <Panel
        fill={colors.newTabCardFill}
        radius={radius.sheet}
        border={colors.newTabCardBorder}
        shadow={SHADOWS.newTabCard}
        style={{ width: NEW_TAB_CARD.width, paddingHorizontal: space.l, paddingVertical: space.ml, flexDirection: "row", alignItems: "center", gap: space.ml }}
      >
        <VisualEffect material="hudWindow" cornerRadius={radius.sheet} style={StyleSheet.absoluteFill} />
        <Favicon url={url} favicon={favicon} profileId={profileId} size={20} />
        <View style={{ flex: 1 }}>
          <Text weight="semibold">{heading}</Text>
          <Text size="small" tone="textSecondary" lines={1} style={{ marginTop: 1 }}>
            {title || displayHostOf(url) || url}
          </Text>
        </View>
        {hovered ? (
          <Text size="small" weight="medium" tone="textSecondary">
            Show
          </Text>
        ) : null}
      </Panel>
    </Pressable>
  );
}
