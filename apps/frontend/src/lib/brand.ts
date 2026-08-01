/**
 * Couleurs de la charte UNCHK, relevées dans le logo officiel.
 *
 * À n'utiliser QUE là où une valeur littérale est techniquement nécessaire —
 * aujourd'hui les vignettes de statistiques, qui composent une teinte
 * translucide par concaténation hexadécimale (`${color}1f`) et ne peuvent donc
 * pas recevoir une var() CSS. Partout ailleurs, passer par les jetons
 * --color-* de styles.css, qui savent basculer en thème sombre.
 */
export const BRAND = {
  /** Dominante. */
  blue: "#046FB7",
  /** Accent. */
  orange: "#E28423",
  /** Sémantique : terminé, en ligne. */
  green: "#179F47",
  /** Sémantique : en direct, destructif. */
  red: "#C0271C",
  /** Neutre franc, tiré du lettrage du logo. */
  slate: "#274958",
} as const;
