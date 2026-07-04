"use client";

import { createContext, useContext } from "react";

const BrandContext = createContext("ThriveTracker");

function normalizeCompanyName(companyName: string) {
  return companyName === "Magik" ? "Magik Tracker" : companyName;
}

export function BrandProvider({
  children,
  companyName,
}: Readonly<{
  children: React.ReactNode;
  companyName: string;
}>) {
  return <BrandContext.Provider value={normalizeCompanyName(companyName)}>{children}</BrandContext.Provider>;
}

export function useBrandName() {
  return useContext(BrandContext);
}
