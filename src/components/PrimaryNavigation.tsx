import React from "react";
import packageJson from "../../package.json";
import {
  Coins,
  History as HistoryIcon,
  MessageSquare,
  ScanSearch,
  Settings,
  Tags,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import divineOrbLogo from "../assets/divine-orb-logo.svg";
import { canViewSaleHistory } from "../appNavigation";

interface PrimaryNavigationProps {
  accountName: string;
}

const navLinkClassName = ({ isActive }: { isActive: boolean }) =>
  `primary-nav__link ${isActive ? "primary-nav__link--active" : ""}`;

export const PrimaryNavigation: React.FC<PrimaryNavigationProps> = ({
  accountName,
}) => (
    <header className="product-navigation">
      <NavLink to="/" end className="product-brand" aria-label="Poe Dash home">
        <span className="product-brand__seal">
          <img
            src={divineOrbLogo}
            alt=""
            data-brand-mark="official-divine-orb"
          />
        </span>
        <span className="product-brand__copy">
          <strong>POE DASH</strong>
          <small>Unofficial free community tool</small>
        </span>
      </NavLink>
      <nav className="primary-nav" aria-label="Primary navigation">
        <NavLink to="/" end className={navLinkClassName}>
          <Tags aria-hidden="true" />
          <span>Your Sales</span>
        </NavLink>
        <NavLink to="/price-check" className={navLinkClassName}>
          <ScanSearch aria-hidden="true" />
          <span>Price Check</span>
        </NavLink>
        <NavLink
          to="/messages"
          className={navLinkClassName}
          aria-label="Chat Monitor"
        >
          <MessageSquare aria-hidden="true" />
          <span>Chat</span>
        </NavLink>
        <NavLink to="/currency-rates" className={navLinkClassName}>
          <Coins aria-hidden="true" />
          <span>Rates</span>
        </NavLink>
        {canViewSaleHistory(accountName) && (
          <NavLink
            to="/sale-history"
            className={navLinkClassName}
            aria-label="Sale History"
          >
            <HistoryIcon aria-hidden="true" />
            <span>History</span>
          </NavLink>
        )}
        <NavLink to="/configuration" className={navLinkClassName}>
          <Settings aria-hidden="true" />
          <span>Settings</span>
        </NavLink>
      </nav>
      <span
        className="product-navigation__version"
        aria-label={`Poe Dash version ${packageJson.version}`}
      >
        v{packageJson.version}
      </span>
    </header>
  );
