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
];

export default eslintConfig;
