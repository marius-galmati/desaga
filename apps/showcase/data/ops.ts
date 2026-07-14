/* Fake operational + analytics data for the staff, management and admin
   surfaces. Deterministic (no Math.random) so screenshots are stable. */

export type Chef = {
  id: string;
  name: string;
  station: string;
  initials: string;
  conformity: number; // 0-5 median over the period
  trend: number; // pp change vs previous period
  plates: number;
  reviews: number;
};

export const CHEFS: Chef[] = [
  {
    id: "c1",
    name: "Andrei Pop",
    station: "Grătar",
    initials: "AP",
    conformity: 4.6,
    trend: 0.3,
    plates: 214,
    reviews: 41,
  },
  {
    id: "c2",
    name: "Ionuț Barbu",
    station: "Sote",
    initials: "IB",
    conformity: 4.2,
    trend: -0.2,
    plates: 188,
    reviews: 33,
  },
  {
    id: "c3",
    name: "Vlad Crișan",
    station: "Garde-manger",
    initials: "VC",
    conformity: 4.7,
    trend: 0.1,
    plates: 156,
    reviews: 29,
  },
  {
    id: "c4",
    name: "Sanda Mureșan",
    station: "Deserturi",
    initials: "SM",
    conformity: 4.4,
    trend: 0.4,
    plates: 132,
    reviews: 27,
  },
  {
    id: "c5",
    name: "Darius Toma",
    station: "Grătar",
    initials: "DT",
    conformity: 3.8,
    trend: -0.5,
    plates: 176,
    reviews: 22,
  },
];

export type DishStat = {
  dishId: string;
  name: string;
  median: number;
  variance: number;
  sample: number;
  wow: number; // week-over-week pp
  spark: number[]; // last 8 weeks median
};

export const DISH_STATS: DishStat[] = [
  {
    dishId: "sarmale",
    name: "Sarmale durdulii cu ciolan",
    median: 4.6,
    variance: 0.4,
    sample: 84,
    wow: 0.2,
    spark: [4.2, 4.3, 4.1, 4.4, 4.5, 4.4, 4.5, 4.6],
  },
  {
    dishId: "taci",
    name: "Taci și-nghite",
    median: 4.7,
    variance: 0.3,
    sample: 71,
    wow: 0.1,
    spark: [4.5, 4.6, 4.6, 4.5, 4.7, 4.6, 4.7, 4.7],
  },
  {
    dishId: "salau-nma",
    name: "Șalău „Nu mă uita”",
    median: 3.9,
    variance: 0.9,
    sample: 52,
    wow: -0.4,
    spark: [4.4, 4.3, 4.2, 4.1, 4.0, 4.1, 3.9, 3.9],
  },
  {
    dishId: "papricas",
    name: "Papricaș de pui zglobiu",
    median: 4.3,
    variance: 0.5,
    sample: 63,
    wow: 0.0,
    spark: [4.2, 4.3, 4.2, 4.3, 4.4, 4.3, 4.3, 4.3],
  },
  {
    dishId: "tartar",
    name: "Biftec tartar",
    median: 4.1,
    variance: 0.6,
    sample: 38,
    wow: 0.3,
    spark: [3.8, 3.9, 3.9, 4.0, 4.0, 4.1, 4.0, 4.1],
  },
  {
    dishId: "papanasi",
    name: "Papanași ropogoși",
    median: 4.8,
    variance: 0.2,
    sample: 96,
    wow: 0.1,
    spark: [4.6, 4.7, 4.7, 4.8, 4.7, 4.8, 4.8, 4.8],
  },
];

export type Ticket = {
  id: string;
  table: number;
  dish: string;
  dishId: string;
  course: string;
  chef: string;
  waitMin: number;
  status: "in_asteptare" | "la_pass" | "servit";
};

export const PASS_QUEUE: Ticket[] = [
  {
    id: "t-418",
    table: 12,
    dish: "Sarmale durdulii cu ciolan",
    dishId: "sarmale",
    course: "Principal",
    chef: "Andrei Pop",
    waitMin: 2,
    status: "la_pass",
  },
  {
    id: "t-419",
    table: 7,
    dish: "Șalău „Nu mă uita”",
    dishId: "salau-nma",
    course: "Principal",
    chef: "Ionuț Barbu",
    waitMin: 4,
    status: "in_asteptare",
  },
  {
    id: "t-420",
    table: 12,
    dish: "Papanași ropogoși",
    dishId: "papanasi",
    course: "Desert",
    chef: "Sanda Mureșan",
    waitMin: 1,
    status: "in_asteptare",
  },
  {
    id: "t-421",
    table: 3,
    dish: "Antricot de vită Limousin",
    dishId: "antricot",
    course: "Principal",
    chef: "Darius Toma",
    waitMin: 6,
    status: "in_asteptare",
  },
];

export type TableState = {
  id: number;
  section: string;
  seats: number;
  status: "liber" | "ocupat" | "cere_nota" | "cheama";
  guests?: number;
  openedMin?: number;
  total?: number;
  waiter: string;
};

export const TABLES: TableState[] = [
  {
    id: 3,
    section: "Terasă",
    seats: 4,
    status: "cere_nota",
    guests: 3,
    openedMin: 92,
    total: 428,
    waiter: "Maria",
  },
  {
    id: 7,
    section: "Salon",
    seats: 2,
    status: "cheama",
    guests: 2,
    openedMin: 34,
    total: 186,
    waiter: "Maria",
  },
  {
    id: 12,
    section: "Salon",
    seats: 6,
    status: "ocupat",
    guests: 5,
    openedMin: 51,
    total: 612,
    waiter: "Radu",
  },
  {
    id: 5,
    section: "Terasă",
    seats: 4,
    status: "ocupat",
    guests: 2,
    openedMin: 18,
    total: 94,
    waiter: "Radu",
  },
  { id: 9, section: "Salon", seats: 2, status: "liber", waiter: "Maria" },
  {
    id: 14,
    section: "Foișor",
    seats: 8,
    status: "ocupat",
    guests: 7,
    openedMin: 76,
    total: 1180,
    waiter: "Radu",
  },
];

/** KPI tiles for the management overview. */
export const KPIS = [
  {
    label: "Conformitate medie",
    value: "4,4",
    unit: "din 5",
    trend: "+0,2 față de luna trecută",
    tone: "var(--pine)",
  },
  {
    label: "Farfurii evaluate",
    value: "866",
    unit: "această lună",
    trend: "+118 față de luna trecută",
    tone: "var(--ink)",
  },
  {
    label: "Rată de fotografiere la pass",
    value: "94",
    unit: "%",
    trend: "peste pragul de 90%",
    tone: "var(--pine)",
  },
  {
    label: "Preparate sub prag",
    value: "1",
    unit: "din 24",
    trend: "Șalău „Nu mă uita”",
    tone: "var(--vin)",
  },
];

/** Alerts for the management inbox. */
export const ALERTS = [
  {
    id: "a1",
    kind: "scădere",
    text: "Șalău „Nu mă uita” — conformitate în scădere a 3-a săptămână la rând.",
    tone: "var(--vin)",
  },
  {
    id: "a2",
    kind: "rată",
    text: "Rata de fotografiere la pass a scăzut sub 90% marți seara.",
    tone: "var(--ochre)",
  },
  {
    id: "a3",
    kind: "revenire",
    text: "Papricaș de pui — revenit peste prag după recalibrare.",
    tone: "var(--pine)",
  },
];
