import React, {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  formatItemMod,
  formatPriceAmount,
  getItemModifierHash,
  getModifierDisplayKind,
  Poe2Item,
} from "../services/types";
import { modifierColorClass } from "./formStyles";

interface ComparableItemDetailsProps {
  item: Poe2Item;
  usedExplicitHashes?: ReadonlySet<string>;
  usedImplicitHashes?: ReadonlySet<string>;
}

export const ComparableItemTooltipContent: React.FC<
  ComparableItemDetailsProps
> = ({ item, usedExplicitHashes, usedImplicitHashes }) => {
  const renderMods = (
    mods: Poe2Item["item"]["explicitMods"],
    section: "implicit" | "explicit" | "enchant",
  ) =>
    mods?.map((mod, index) => {
      const kind = getModifierDisplayKind(item, section, index);
      const usedHashes =
        section === "explicit"
          ? usedExplicitHashes
          : section === "implicit"
            ? usedImplicitHashes
            : undefined;
      const hash = getItemModifierHash(item, section, index, mod);
      const isUsed = !usedHashes || !hash || usedHashes.has(hash);

      return (
        <li
          key={index}
          className={`${modifierColorClass(kind)} ${isUsed ? "" : "line-through opacity-60"}`}
          title={isUsed ? kind : `${kind} · not used in search`}
        >
          {formatItemMod(mod)}
        </li>
      );
    });

  return (
    <div className="comparable-tooltip__content">
      <div className="comparable-tooltip__header">
        {item.item.icon && (
          <img src={item.item.icon} alt="" className="comparable-tooltip__image" />
        )}
        <div>
          <p className="comparable-tooltip__name">
            {item.item.name || item.item.typeLine || item.item.baseType}
          </p>
          <p className="comparable-tooltip__type">
            {item.item.rarity} {item.item.typeLine || item.item.baseType}
          </p>
          <p className="comparable-tooltip__meta">
            Item level {item.item.ilvl} ·{" "}
            {formatPriceAmount(item.listing.price.amount)}{" "}
            {item.listing.price.currency}
          </p>
        </div>
      </div>

      {item.item.corrupted && (
        <p className="comparable-tooltip__corrupted">Corrupted</p>
      )}

      {item.item.properties?.length > 0 && (
        <ul className="comparable-tooltip__properties">
          {item.item.properties.map((property, index) => (
            <li key={index}>
              {property.name}: {property.values.map((value) => value[0]).join(", ")}
            </li>
          ))}
        </ul>
      )}

      {item.item.implicitMods?.length ? (
        <div className="comparable-tooltip__section comparable-tooltip__section--implicit">
          <p>Implicit</p>
          <ul>{renderMods(item.item.implicitMods, "implicit")}</ul>
        </div>
      ) : null}

      {item.item.enchantMods?.length ? (
        <div className="comparable-tooltip__section comparable-tooltip__section--enchant">
          <p>Enchant</p>
          <ul>{renderMods(item.item.enchantMods, "enchant")}</ul>
        </div>
      ) : null}

      {item.item.explicitMods?.length ? (
        <div className="comparable-tooltip__section comparable-tooltip__section--explicit">
          <p>Explicit</p>
          <ul>{renderMods(item.item.explicitMods, "explicit")}</ul>
        </div>
      ) : null}

      {item.item.sockets?.length ? (
        <p className="comparable-tooltip__sockets">
          Sockets: {item.item.sockets.length}
        </p>
      ) : null}
    </div>
  );
};

interface ComparableItemHoverCardProps extends ComparableItemDetailsProps {
  children: ReactNode;
  className?: string;
}

export const ComparableItemHoverCard: React.FC<
  ComparableItemHoverCardProps
> = ({
  item,
  usedExplicitHashes,
  usedImplicitHashes,
  children,
  className = "",
}) => {
  const anchorRef = useRef<HTMLDivElement>(null);
  const hideTimeout = useRef<number | undefined>(undefined);
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 8, left: 8 });
  const tooltipId = useId();
  const itemName = item.item.name || item.item.typeLine || item.item.baseType;

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const gap = 8;
    const tooltipWidth = Math.min(384, window.innerWidth - 16);
    const tooltipHeight = Math.min(460, window.innerHeight - 16);
    const leftOfAnchor = rect.left - tooltipWidth - gap;
    const left =
      leftOfAnchor >= 8
        ? leftOfAnchor
        : Math.min(rect.right + gap, window.innerWidth - tooltipWidth - 8);
    const top = Math.min(
      Math.max(8, rect.top),
      Math.max(8, window.innerHeight - tooltipHeight - 8),
    );

    setPosition({ top, left });
  }, []);

  const showTooltip = () => {
    window.clearTimeout(hideTimeout.current);
    updatePosition();
    setIsVisible(true);
  };

  const hideTooltip = () => {
    hideTimeout.current = window.setTimeout(() => setIsVisible(false), 120);
  };

  useEffect(() => {
    return () => window.clearTimeout(hideTimeout.current);
  }, []);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isVisible, updatePosition]);

  const tooltip = isVisible ? (
    <div
      id={tooltipId}
      role="tooltip"
      className="comparable-item-tooltip"
      style={{ top: position.top, left: position.left }}
      onMouseEnter={() => window.clearTimeout(hideTimeout.current)}
      onMouseLeave={hideTooltip}
    >
      <ComparableItemTooltipContent
        item={item}
        usedExplicitHashes={usedExplicitHashes}
        usedImplicitHashes={usedImplicitHashes}
      />
    </div>
  ) : null;

  return (
    <div
      ref={anchorRef}
      tabIndex={0}
      aria-label={`View details for ${itemName}`}
      aria-describedby={isVisible ? tooltipId : undefined}
      className={className}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setIsVisible(false);
        }
      }}
    >
      {children}
      {typeof document !== "undefined" && tooltip
        ? createPortal(tooltip, document.body)
        : null}
    </div>
  );
};
