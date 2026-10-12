// ESLint rules for docs/design/silver-lining.md section 13 "Token-only styling".
//   silver-lining/no-raw-color      hex / rgb() / rgba() / hsl() / hsla() in code
//   silver-lining/no-offscale-font  px font sizes outside 11 12 13 14 15 17 24
// Colour comes from tokens (Tailwind utilities or var(--sl-*)); type from the scale.

export const FONT_SCALE_PX = [11, 12, 13, 14, 15, 17, 24];

const HEX = /(?<![\w&#-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const FN = /\b(?:rgba?|hsla?)\(/g;
// Tailwind named sizes whose rendered px is off the scale (xs=12, sm=14, 2xl=24 are on it)
const TW_NAMED_OFF = /(?<![\w-])text-(?:base|lg|xl|[3-9]xl)(?![\w-])/g;
const TW_ARBITRARY = /(?<![\w-])text-\[(\d+(?:\.\d+)?)px\]/g;

const SKIP_ATTRS = new Set(["href", "id", "htmlFor", "src", "xmlns", "d", "viewBox", "points"]);

function colorHits(text) {
  const hits = [];
  for (const re of [HEX, FN]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) hits.push(m[0]);
  }
  return hits;
}

function fontHits(text) {
  const hits = [];
  TW_NAMED_OFF.lastIndex = 0;
  for (const m of text.matchAll(TW_NAMED_OFF)) hits.push(m[0]);
  TW_ARBITRARY.lastIndex = 0;
  for (const m of text.matchAll(TW_ARBITRARY)) {
    if (!FONT_SCALE_PX.includes(Number(m[1]))) hits.push(m[0]);
  }
  return hits;
}

function inSkippedAttr(node) {
  const p = node.parent;
  return p?.type === "JSXAttribute" && SKIP_ATTRS.has(p.name?.name);
}

const noRawColor = {
  meta: {
    type: "problem",
    schema: [],
    messages: { raw: "Raw colour {{value}}: use a Silver Lining token (Tailwind utility or var(--sl-*))." },
  },
  create(context) {
    const check = (node, text) => {
      for (const value of colorHits(text)) context.report({ node, messageId: "raw", data: { value } });
    };
    return {
      Literal(node) {
        if (typeof node.value === "string" && !inSkippedAttr(node)) check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? "");
      },
    };
  },
};

const noOffscaleFont = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      off: "Font size {{value}} is off the type scale (11 12 13 14 15 17 24 px).",
    },
  },
  create(context) {
    const check = (node, text) => {
      for (const value of fontHits(text)) context.report({ node, messageId: "off", data: { value } });
    };
    const checkPx = (node, n) => {
      if (!FONT_SCALE_PX.includes(n)) {
        context.report({ node, messageId: "off", data: { value: `fontSize ${n}` } });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? "");
      },
      Property(node) {
        const key = node.key.type === "Identifier" ? node.key.name : node.key.value;
        if (key !== "fontSize") return;
        const v = node.value;
        if (v.type === "Literal" && typeof v.value === "number") checkPx(v, v.value);
        else if (v.type === "Literal" && typeof v.value === "string") {
          const m = /^(\d+(?:\.\d+)?)px$/.exec(v.value);
          if (m) checkPx(v, Number(m[1]));
        }
      },
    };
  },
};

const plugin = {
  meta: { name: "silver-lining" },
  rules: { "no-raw-color": noRawColor, "no-offscale-font": noOffscaleFont },
};

export default plugin;
