/* Real Desaga menu (subset), used across the guest, admin and management
   surfaces so content stays consistent. Prices are illustrative (RON).
   `tone` drives the placeholder-photo gradient until real 4K photos slot in. */

export type Dish = {
  id: string;
  name: string;
  desc: string;
  price: number;
  tags?: string[];
  signature?: boolean;
  tone: string; // css color for placeholder photo
};

export type MenuCategory = {
  id: string;
  name: string;
  note?: string;
  dishes: Dish[];
};

export const MENU: MenuCategory[] = [
  {
    id: "aperitive",
    name: "Aperitive",
    dishes: [
      {
        id: "mici",
        name: "Mici Euphoria",
        desc: "Din vită și porc, la grătar, cu muștar de casă.",
        price: 8,
        tone: "#7a4a2c",
        signature: true,
      },
      {
        id: "carnati-pic",
        name: "Cârnați picanți Euphoria",
        desc: "Afumați în casă, cu ardei iute și usturoi.",
        price: 28,
        tone: "#8a3324",
      },
      {
        id: "salau-file",
        name: "File de șalău",
        desc: "Prăjit crocant, cu felie de lămâie.",
        price: 42,
        tone: "#b8955a",
      },
      {
        id: "pastrav-file",
        name: "File de păstrăv",
        desc: "De munte, rumenit la tigaie.",
        price: 38,
        tone: "#9a7b4f",
      },
    ],
  },
  {
    id: "ciorbe",
    name: "Ciorbe & Supe",
    note: "Se servesc până la ora 18:00",
    dishes: [
      {
        id: "ciorba-burta",
        name: "Ciorbă de burtă",
        desc: "Cu os de vită, smântână și ardei iute, ca la carte.",
        price: 26,
        tone: "#c9a24a",
        signature: true,
      },
      {
        id: "ciorba-fasole",
        name: "Ciorbă de fasole cu ciolan afumat",
        desc: "Legată, cu ceapă călită și tarhon.",
        price: 24,
        tone: "#a67c3a",
      },
      {
        id: "supa-taietei",
        name: "Supă de pui cu tăieței",
        desc: "Cu tăieței de casă, întinși cu mâna.",
        price: 22,
        tone: "#d0b060",
      },
      {
        id: "ciorba-perisoare",
        name: "Ciorbă de perișoare",
        desc: "Acrită cu borș, cu leuștean proaspăt.",
        price: 24,
        tone: "#b58a3e",
      },
    ],
  },
  {
    id: "principale",
    name: "Feluri principale",
    dishes: [
      {
        id: "sarmale",
        name: "Sarmale durdulii cu ciolan",
        desc: "În foaie de varză murată, cu mămăligă și smântână.",
        price: 44,
        tone: "#6f4326",
        signature: true,
      },
      {
        id: "taci",
        name: "Taci și-nghite",
        desc: "Mămăligă cu brânză, jumări și ou ochi — vorbește singură.",
        price: 38,
        tone: "#c98f3a",
        signature: true,
      },
      {
        id: "ciolan",
        name: "Ciolan de-ți lasă gura apă",
        desc: "Copt încet la cuptor, cu varză călită.",
        price: 58,
        tone: "#7c4a29",
      },
      {
        id: "salau-nma",
        name: "Șalău „Nu mă uita”",
        desc: "File cu cartofi noi și fasole verde, cu unt de lămâie.",
        price: 62,
        tone: "#a98a56",
        signature: true,
      },
      {
        id: "papricas",
        name: "Papricaș de pui zglobiu",
        desc: "Cu pulpe de pui și găluște, în sos de boia dulce.",
        price: 42,
        tone: "#b0491f",
      },
      {
        id: "tocanita-ung",
        name: "Tocăniță ungurească",
        desc: "De vită, în sos de vin roșu, cu gnocchi.",
        price: 54,
        tone: "#8a2e21",
      },
      {
        id: "antricot",
        name: "Antricot de vită Limousin",
        desc: "La grătar, cu unt aromat și legume.",
        price: 96,
        tone: "#5f2f22",
      },
      {
        id: "tartar",
        name: "Biftec tartar",
        desc: "Cu măduvă la grătar și pită prăjită.",
        price: 68,
        tone: "#8a3626",
      },
      {
        id: "gulyas",
        name: "Gulyás de vită Limousin",
        desc: "Cu găluște și boia, gros și aromat.",
        price: 48,
        tone: "#9a3820",
      },
      {
        id: "rata",
        name: "Pulpă de rață rumenită",
        desc: "Cu condimente, pe pat de varză roșie.",
        price: 64,
        tone: "#7a3f28",
      },
    ],
  },
  {
    id: "garnituri",
    name: "Brânzeturi & Garnituri",
    dishes: [
      {
        id: "palanet-branza",
        name: "Palaneț cu brânză",
        desc: "Plăcintă cu brânză și ceapă verde, coaptă pe vatră.",
        price: 22,
        tone: "#c6a35c",
      },
      {
        id: "pita",
        name: "Pită picurată",
        desc: "Cu jumări și brânză, direct din cuptor.",
        price: 18,
        tone: "#b58948",
      },
      {
        id: "mamaliga",
        name: "Mămăligă la grătar",
        desc: "Feliată și rumenită pe plită.",
        price: 12,
        tone: "#d4b25c",
      },
      {
        id: "hribi",
        name: "Hribi trași la tigaie",
        desc: "Cu usturoi și pătrunjel.",
        price: 26,
        tone: "#7c5a34",
      },
    ],
  },
  {
    id: "deserturi",
    name: "Deserturi",
    dishes: [
      {
        id: "papanasi",
        name: "Papanași ropogoși",
        desc: "Cu smântână și dulceață de afine, calzi.",
        price: 26,
        tone: "#d9b96a",
        signature: true,
      },
      {
        id: "somloi",
        name: "Somlói galuska",
        desc: "Pandișpan însiropat, cu nucă și sos de ciocolată.",
        price: 24,
        tone: "#6f4a2c",
      },
      {
        id: "arsa",
        name: "Arsă și delicioasă",
        desc: "Crème brûlée cu crustă de zahăr caramelizat.",
        price: 22,
        tone: "#c48a3e",
      },
      {
        id: "tarta-mere",
        name: "Tartă cu mere și nuci",
        desc: "Cu aluat fraged și scorțișoară.",
        price: 22,
        tone: "#b07a3c",
      },
    ],
  },
];

export const ALL_DISHES: Dish[] = MENU.flatMap((c) => c.dishes);
export function dishById(id: string): Dish | undefined {
  return ALL_DISHES.find((d) => d.id === id);
}
export const DISH_COUNT_REAL = 108; // "peste 100 de preparate"
