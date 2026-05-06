import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Temporarily ignore data-layer files until they are fully typed/linted
    ignores: [
      "src/lib/yahoo-fantasy-api.ts",
      "src/lib/fantasy/**/*",
    ],
  },
  {
    // Enforce design-system discipline: raw heading elements bypass the
    // typography spec (Pacifico display font + fluid clamp sizes from
    // globals.css). New code must reach for <Heading> / <Text> from
    // @/components/typography so visual changes happen in one place.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/components/typography/**",
      "src/app/globals.css",
    ],
    rules: {
      "react/forbid-elements": [
        "error",
        {
          forbid: [
            { element: "h1", message: 'Use <Heading as="h1"> from @/components/typography.' },
            { element: "h2", message: 'Use <Heading as="h2"> from @/components/typography.' },
            { element: "h3", message: 'Use <Heading as="h3"> from @/components/typography.' },
            { element: "h4", message: 'Use <Heading as="h4"> from @/components/typography.' },
            { element: "h5", message: 'Use <Heading as="h5"> from @/components/typography.' },
            { element: "h6", message: 'Use <Heading as="h6"> from @/components/typography.' },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
