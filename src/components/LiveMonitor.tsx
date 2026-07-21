import React, { useCallback, useEffect, useState } from "react";
import { formatPriceAmount, Poe2Item, Price } from "../services/types";
import { Estimate, PriceChecker } from "../services/PriceEstimator";
import {
  LiveMonitorButton,
  type LiveMonitorStatus,
} from "./LiveMonitorButton";

interface LiveMonitorProps {
  items: Poe2Item[];
  priceSuggestions: Record<string, Estimate>;
  league: string;
  status: LiveMonitorStatus;
  onToggle: () => void;
}

const LiveMonitor: React.FC<LiveMonitorProps> = ({
  items,
  priceSuggestions,
  league,
  status,
  onToggle,
}) => {
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [elapsedTime, setElapsedTime] = useState<string>("00:00:00");
  const [totalListingValue, setTotalListingValue] = useState<
    Price | undefined
  >();
  const [totalSuggestedValue, setTotalSuggestedValue] = useState<
    Price | undefined
  >();

  const [listedValuePerHour, setListedValuePerHour] =
    useState("0.00 exalted");

  useEffect(() => {
    if (status !== "watching") {
      setStartTime(null);
      setElapsedTime("00:00:00");
      return;
    }

    const currentTime = new Date();
    setStartTime(currentTime);

    const timer = setInterval(() => {
      if (currentTime) {
        const now = new Date();
        const diff = now.getTime() - currentTime.getTime();
        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        const elapsed = `${hours.toString().padStart(2, "0")}:${minutes
          .toString()
          .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

        setElapsedTime(elapsed);
      }
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [status]);

  const calculateTotalValue = useCallback(async (items: Poe2Item[]) => {
    const currency = "exalted";

    const equivalentPrice = PriceChecker.toEquivalentPrices(
      currency,
      items.map((i) => ({
        amount: i.listing.price.amount,
        currency: i.listing.price.currency,
      })),
      league,
    );

    const total = PriceChecker.sumPrice(equivalentPrice);

    const upscaled = items.length
      ? await PriceChecker.upscalePrice(total, league)
      : total;

    setTotalListingValue(upscaled);

    return upscaled;
  }, [league]);

  const calculateTotalSuggestedValue = useCallback(
    async (
      items: Poe2Item[],
      suggestions: Record<string, Estimate>,
    ) => {
      const currency = "exalted";

      const equivalentPrice = PriceChecker.toEquivalentPrices(
        currency,
        items.map((i) => ({
          amount: suggestions[i.id]?.price?.amount || 0,
          currency: suggestions[i.id]?.price?.currency || "exalted",
        })),
        league,
      );

      const total = PriceChecker.sumPrice(equivalentPrice);

      const upscaled = items.length
        ? await PriceChecker.upscalePrice(total, league)
        : total;

      setTotalSuggestedValue(upscaled);

      return upscaled;
    },
    [league],
  );

  useEffect(() => {
    calculateTotalValue(items);
    calculateTotalSuggestedValue(items, priceSuggestions);
  }, [
    calculateTotalSuggestedValue,
    calculateTotalValue,
    items,
    priceSuggestions,
  ]);

  useEffect(() => {
    let cancelled = false;

    const calculateCurrencyPerHour = async () => {
      const zeroValue = "0.00 exalted";
      if (status !== "watching" || !startTime) {
        if (!cancelled) {
          setListedValuePerHour(zeroValue);
        }
        return zeroValue;
      }

      const listedPerHour = totalListingValue
        ? await PriceChecker.upscalePricePerHour(
            totalListingValue,
            Date.now() - startTime.getTime(),
            league,
          )
        : zeroValue;
      const listedPerHourLabel =
        typeof listedPerHour === "string"
          ? listedPerHour
          : `${formatPriceAmount(listedPerHour.amount)} ${listedPerHour.currency}`;

      if (!cancelled) {
        setListedValuePerHour(listedPerHourLabel);
      }

      return listedPerHourLabel;
    };

    void calculateCurrencyPerHour();

    return () => {
      cancelled = true;
    };
  }, [elapsedTime, league, status, totalListingValue, startTime]);

  const numDrops = items.length;
  const listingValue = totalListingValue
    ? `${totalListingValue.amount.toFixed(2)} ${totalListingValue.currency}`
    : "0.00 exalted";
  const suggestedValue = totalSuggestedValue
    ? `${totalSuggestedValue.amount.toFixed(2)} ${totalSuggestedValue.currency}`
    : "0.00 exalted";

  return (
    <footer
      className="live-metrics surface-card"
      aria-label="Live monitor"
      data-monitor-status={status}
    >
      <header className="live-metrics__header">
        <LiveMonitorButton status={status} onToggle={onToggle} />
      </header>
      <div
        className="live-metrics__grid"
        role="group"
        aria-label="Live sales summary"
      >
        <article className="metric-tile">
          <p>New items</p>
          <strong>{numDrops}</strong>
        </article>
        <article className="metric-tile">
          <p>Listed value</p>
          <strong>{listingValue}</strong>
        </article>
        <article className="metric-tile">
          <p>Suggested value</p>
          <strong>{suggestedValue}</strong>
        </article>
        <article className="metric-tile metric-tile--wide">
          <p>Listed per hour</p>
          <strong>{listedValuePerHour}/hr</strong>
        </article>
      </div>
    </footer>
  );
};

export default LiveMonitor;
