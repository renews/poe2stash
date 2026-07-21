import React from "react";
import {
  Coins,
  History as HistoryIcon,
  MessageSquare,
  Settings,
  Tags,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import appIcon from "../assets/poe-dash-brand-seal.png";
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
          <img src={appIcon} alt="" />
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
    </header>
  );
