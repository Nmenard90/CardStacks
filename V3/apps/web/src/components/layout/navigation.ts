export interface NavigationItem {
  label: string;
  path: string;
  auth: "public" | "signed-in" | "admin";
}

export const NAVIGATION: NavigationItem[] = [
  { label: "Search / Catalog", path: "/", auth: "public" },
  { label: "Browse Sets", path: "/catalog", auth: "public" },
  { label: "Search", path: "/search", auth: "public" },
  { label: "Collection", path: "/collection", auth: "signed-in" },
  { label: "Bulk Add", path: "/bulk-add", auth: "signed-in" },
  { label: "Binders", path: "/binders", auth: "signed-in" },
  { label: "Master Sets", path: "/master-sets", auth: "signed-in" },
  { label: "Imports / Exports", path: "/imports-exports", auth: "signed-in" },
  { label: "Trade Tools", path: "/trade-tools", auth: "signed-in" },
  { label: "Convention Mode", path: "/convention", auth: "signed-in" },
  { label: "Profile", path: "/profile", auth: "signed-in" },
  { label: "Admin", path: "/admin", auth: "admin" }
];
