function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

const titles = [
  "Random 8 - Random - 0.25%", "The Joker - Community - 0.30%", "Random 7 - Random - 0.45%",
  "Random 6 - Random - 0.65%", "1980's Computer Gaming - Community - 0.70%", "Rainbow in the Sky - Sky - 0.75%",
  "Cuba Libre - Drinks - 0.75%", "Sunset Dreams - Sky - 0.75%", "Random 2 - Random - 1.23%",
  "The Grey Beyond - Community - 1.28%", "Peacock - Community - 1.29%", "Lemon Lime - Colors = 1.35%",
  "Cuppa Joe - Drinks - 1.38%", "Purple Haze - Colors - 1.39%", "Sunny Day - Outdoors - 1.40%",
  "Storm on the Horizon - Sky - 1.45%", "Random 3 - Random - 1.58%", "Swankpie Strawberries - Community - 1.63%",
  "Swankpie Diamonds - Community - 1.63%", "Ice Age - Community - 1.64%", "Swimming Shorts - Community - 1.65%",
  "Fiesta - Colors - 1.68%", "Desert Rose - Colors - 1.68%", "Cheerful - Colors - 1.68%",
  "Sailing the Seas - Colors - 1.68%", "Radiant Splash - Colors - 1.68%", "R to the G to the B - Colors - 1.70%",
  "Random 4 - Random - 1.94%", "Pineapple - Community - 2%", "Cool Blue - Colors - 2.17%",
  "Dank Delight - Colors - 2.18%", "Early Morning Walk - Sky - 2.19%", "Coral Reef - Colors - 2.19%",
  "Random 5 - Random - 2.32%", "Solar Flare - Community - 2.35%", "Lavender - Community - 2.35%",
  "Southern Lights - Community - 2.35%", "Bibbidi Bobbidi Boo - Community 2.35%", "The Great Outdoors - Outdoors - 2.42%",
  "Mountain Top - Outdoors - 2.42%", "Antarctica - Outdoors - 2.45%", "Violet Rain - Colors - 2.45%",
  "Midori Sour - Drinks - 2.47%", "A Day at the Beach - Outdoors - 2.53%", "Blue Lagoon - Drinks - 2.53%",
  "Cotton Candy - Colors - 2.54%", "Singapore Sling - Drinks - 2.64%", "Death in the Afternoon - Drinks - 2.64%",
  "Summer Heat - Outdoors - 2.75%", "What the Funk - Colors - 2.77%", "Exotic - Colors - 2.77%",
  "Throwback Thursday - Colors - 2.79%", "Spring Medley - Outdoors - 2.88%", "Fruit Bowl - Colors - 2.94%"
];

const gradientNumber = { 1: 8, 3: 7, 4: 6, 9: 2, 17: 3, 28: 4, 34: 5 };

const fixedColorsByCanvas = {
  2: ["#7AAE3D", "#96C93D", "#7554A3", "#674099", "#F6971F", "#FEC20F", "#D44359", "#9C3161"],
  5: ["#FF0000", "#00FF00", "#0000FF", "#00FFFF", "#FF00FF", "#FFFF00"],
  6: ["#A800FF", "#0079FF", "#00F11D", "#FFEF00", "#FF7F00", "#FF0900"],
  7: ["#8A480B", "#C16F1D", "#CC8545", "#DBD694", "#FAFD3A", "#97BB7C"],
  8: ["#9E258F", "#FD4470", "#FF8252", "#FDB046", "#FDCD50", "#FDE767"],
  10: ["#D3D3D3", "#BFE2FE"],
  11: ["#326872", "#F5E653"],
  12: ["#8BBE1C", "#FFF44F"],
  13: ["#F2EDD7FF", "#755139FF"],
  14: ["#00239CFF", "#E10600FF"],
  15: ["#00B1D2FF", "#FDDB27FF"],
  16: ["#949398FF", "#F4DF4EFF"],
  18: ["#EF1C1C", "#F66F6F", "#F3BEBE"],
  19: ["#00FFFF", "#6EA2E5", "#F3DCFB"],
  20: ["#E7EAEF", "#9BA8B8", "#05828E"],
  21: ["#00A19D", "#FFB344", "#E05D5D"],
  22: ["#F6EA7BFF", "#FFBA52FF", "#E683A9FF"],
  23: ["#A59C94FF", "#AE0E36FF", "#D32E5EFF"],
  24: ["#00A5CB", "#FE3EA5", "#EEFF01"],
  25: ["#95DBE5FF", "#078282FF", "#339E66FF"],
  26: ["#F9A12EFF", "#FC766AFF", "#9B4A97FF"],
  27: ["#DA291CFF", "#56A8CBFF", "#53A567FF"],
  29: ["#A56E15", "#EBBE23", "#FFE84A", "#81CE40"],
  30: ["#08B6CE", "#74D5DD", "#398AD7", "#2F66A9"],
  31: ["#059033", "#93CB56", "#7BAA47", "#355A20"],
  32: ["#984539", "#F6C363", "#F4A04D", "#5C4C6C"],
  33: ["#DB5D7C", "#F47E7E", "#FDB17E", "#ECC884"],
  35: ["#F50C0C", "#EF5C0C", "#EB7C08", "#EDB404", "#FFDC77"],
  36: ["#9955BB", "#B666D3", "#D991EE", "#00E6E6", "#2F6EAE"],
  37: ["#8BE2D2", "#A9E04B", "#462E7A", "#7DCB63", "#EB2C59"],
  38: ["#2D7FBC", "#2A6A9B", "#F4F6F4", "#95BCDF", "#DEBD57"],
  39: ["#D58A60", "#40663F", "#497381", "#548F01", "#D457CF"],
  40: ["#3F74A2", "#536664", "#648418", "#A49CA4", "#4C849C"],
  41: ["#27A8F7", "#98D4FF", "#D1E1FF", "#BAC3E0", "#FFFAFA"],
  42: ["#55508D", "#726DA8", "#7D8CC4", "#A0d2DB", "#BEE7E8"],
  43: ["#06AC02", "#66CC02", "#A5E88C", "#D0EFF4", "#DA0106"],
  44: ["#AAF6FF", "#77D6FF", "#FFF3B9", "#FFDE38", "#FF6F56"],
  45: ["#0261DF", "#00ACEE", "#32D5F2", "#CFE9F2", "#F8564F"],
  46: ["#FFB3BA", "#FFDFBA", "#FFFFBA", "#BAFFC9", "#BAE1FF"],
  47: ["#BE1D1E", "#E54124", "#F3892B", "#F7AE2B", "#FADAA7"],
  48: ["#6C8B44", "#789740", "#DBBF65", "#F1BF38", "#F3BF11"],
  49: ["#FF4E50", "#FC913A", "#F9D62E", "#EAE374", "#E2f4C7"],
  50: ["#008080", "#A4DEBF", "#EF0041", "#FFE33D", "#FF5BD7"],
  51: ["#026186", "#E1057C", "#F9A406", "#8E0387", "#76C40D"],
  52: ["#DD6137", "#E3A960", "#52946B", "#4F859A", "#6CB6B1"],
  53: ["#F7F4CB", "#FFCB00", "#C6DF0F", "#77B5EC", "#E64F77"],
  54: ["#8FAE5E", "#F9D44F", "#FF786C", "#C64A88", "#4E3B7B"]
};

function parseTitleRecord(raw) {
  const m = raw.match(/^(.*?)\s*-\s*([A-Za-z &]+?)\s*(?:-\s*|=\s*|\s+)(\d+(?:\.\d+)?)%$/);
  if (!m) {
    throw new Error(`Unparseable refresh title: ${raw}`);
  }
  return {
    name: m[1].trim(),
    category: m[2].trim(),
    rarity: Number(m[3])
  };
}

export const refreshTitles = titles.map((raw, idx) => {
  const n = idx + 1;
  const parsed = parseTitleRecord(raw);
  const fixed = fixedColorsByCanvas[n] ?? null;
  const randomCount = gradientNumber[n];

  return {
    slug: slugify(`${parsed.name}-${parsed.category}-${parsed.rarity}`),
    label: raw,
    category: parsed.category,
    rarity: parsed.rarity,
    colors: randomCount ? null : fixed,
    randomSpec: randomCount ? { count: randomCount, seedScale: 1 } : null
  };
});
