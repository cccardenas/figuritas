const stickerKeyPattern = /^(?=.{1,80}$)[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

const worldCup2026TeamCodes = [
  "MEX",
  "RSA",
  "KOR",
  "CZE",
  "CAN",
  "BIH",
  "QAT",
  "SUI",
  "BRA",
  "MAR",
  "HAI",
  "SCO",
  "USA",
  "PAR",
  "AUS",
  "TUR",
  "GER",
  "CUW",
  "CIV",
  "ECU",
  "NED",
  "JPN",
  "SWE",
  "TUN",
  "BEL",
  "EGY",
  "IRN",
  "NZL",
  "ESP",
  "CPV",
  "KSA",
  "URU",
  "FRA",
  "SEN",
  "IRQ",
  "NOR",
  "ARG",
  "ALG",
  "AUT",
  "JOR",
  "POR",
  "COD",
  "UZB",
  "COL",
  "ENG",
  "CRO",
  "GHA",
  "PAN",
];

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getWorldCup2026CatalogKeys() {
  const fwcKeys = ["FWC-00"];

  for (let index = 1; index <= 19; index += 1) {
    fwcKeys.push(`FWC-${index}`);
  }

  return [
    ...fwcKeys,
    ...worldCup2026TeamCodes.flatMap((countryKey) =>
      Array.from({ length: 20 }, (_, index) => `${countryKey}-${index + 1}`),
    ),
  ];
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstTextValue(payload, names) {
  for (const name of names) {
    const text = normalizeText(payload?.[name]);
    if (text) return text;
  }

  return "";
}

function isListHeader(line, headers) {
  const normalized = String(line || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[:\s]+$/g, "");

  return headers.includes(normalized);
}

function splitCombinedText(text) {
  const missingLines = [];
  const duplicatesLines = [];
  let target = missingLines;

  for (const line of String(text || "").split(/\r?\n/)) {
    if (isListHeader(line, ["repetidas", "sobrantes", "duplicadas", "repetidos"])) {
      target = duplicatesLines;
      continue;
    }

    if (isListHeader(line, ["faltantes", "faltan", "faltas"])) {
      target = missingLines;
      continue;
    }

    target.push(line);
  }

  return {
    missingText: missingLines.join("\n").trim(),
    duplicatesText: duplicatesLines.join("\n").trim(),
  };
}

function normalizeExternalTextPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createHttpError(400, "Formato de importacion invalido");
  }

  const combinedText = firstTextValue(payload, ["text", "rawText", "texto"]);
  const splitText = combinedText ? splitCombinedText(combinedText) : {};

  return {
    missingText:
      firstTextValue(payload, [
        "missingText",
        "missing",
        "faltantesText",
        "faltantes",
        "faltanText",
      ]) || splitText.missingText || "",
    duplicatesText:
      firstTextValue(payload, [
        "duplicatesText",
        "duplicates",
        "repeatedText",
        "repetidasText",
        "repetidas",
        "sobrantesText",
        "sobrantes",
      ]) || splitText.duplicatesText || "",
  };
}

function normalizeStickerToken(token) {
  return String(token || "")
    .trim()
    .toUpperCase()
    .replace(/^[#]+/g, "")
    .replace(/[^A-Z0-9-]/g, "");
}

function parseStickerTokens(value) {
  return String(value || "")
    .split(/[,;]+/)
    .flatMap((part) => part.trim().split(/\s+/))
    .map(normalizeStickerToken)
    .filter(Boolean);
}

function normalizeStickerNumber(countryKey, number) {
  const safeNumber = String(number || "").trim().toUpperCase();

  if (countryKey === "FWC" && /^(?:00|0?[1-9]|1[0-9])$/.test(safeNumber)) {
    return safeNumber === "00" ? "00" : String(Number(safeNumber));
  }

  return safeNumber;
}

function parseStickerListText(text) {
  const itemsByKey = new Map();
  const ignoredLines = [];
  const safeText = normalizeText(text);

  if (!safeText) {
    return { items: [], itemsByKey, ignoredLines };
  }

  const lines = safeText.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (
      isListHeader(trimmed, [
        "faltantes",
        "faltan",
        "faltas",
        "repetidas",
        "sobrantes",
        "duplicadas",
        "repetidos",
      ])
    ) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) {
      ignoredLines.push(trimmed);
      continue;
    }

    const label = trimmed.slice(0, separatorIndex).trim();
    const countryMatch = label.match(/^([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)/);

    if (!countryMatch) {
      ignoredLines.push(trimmed);
      continue;
    }

    const countryKey = countryMatch[1].toUpperCase();
    const tokens = parseStickerTokens(trimmed.slice(separatorIndex + 1));

    if (tokens.length === 0) {
      ignoredLines.push(trimmed);
      continue;
    }

    for (const token of tokens) {
      const number = normalizeStickerNumber(countryKey, token);
      const stickerKey = `${countryKey}-${number}`;

      if (!stickerKeyPattern.test(stickerKey)) {
        throw createHttpError(400, `Codigo de figurita invalido: ${stickerKey}`);
      }

      const existing = itemsByKey.get(stickerKey);

      if (existing) {
        existing.quantity += 1;
      } else {
        itemsByKey.set(stickerKey, {
          stickerKey,
          countryKey,
          number,
          quantity: 1,
        });
      }
    }
  }

  return {
    items: Array.from(itemsByKey.values()).sort(compareStickerItems),
    itemsByKey,
    ignoredLines,
  };
}

function getStickerParts(stickerKey) {
  const safeStickerKey = String(stickerKey || "");
  const separatorIndex = safeStickerKey.lastIndexOf("-");

  if (separatorIndex === -1) {
    return {
      stickerKey: safeStickerKey,
      countryKey: safeStickerKey,
      number: safeStickerKey,
    };
  }

  return {
    stickerKey: safeStickerKey,
    countryKey: safeStickerKey.slice(0, separatorIndex),
    number: safeStickerKey.slice(separatorIndex + 1),
  };
}

function compareStickerItems(a, b) {
  const countryCompare = a.countryKey.localeCompare(b.countryKey);
  if (countryCompare !== 0) return countryCompare;

  const aNumber = Number(a.number);
  const bNumber = Number(b.number);

  if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) {
    return aNumber - bNumber;
  }

  return a.number.localeCompare(b.number);
}

function parseExternalStickerText(payload, options = {}) {
  const { requireMissing = false, requireAny = true } = options;
  const input = normalizeExternalTextPayload(payload);
  const missing = parseStickerListText(input.missingText);
  const duplicates = parseStickerListText(input.duplicatesText);

  if (requireMissing && missing.items.length === 0) {
    throw createHttpError(400, "Debes enviar el texto de faltantes para importar el album");
  }

  if (requireAny && missing.items.length === 0 && duplicates.items.length === 0) {
    throw createHttpError(400, "Debes enviar faltantes o repetidas");
  }

  const conflicts = duplicates.items
    .filter((item) => missing.itemsByKey.has(item.stickerKey))
    .map((item) => item.stickerKey);

  if (conflicts.length > 0) {
    throw createHttpError(
      400,
      `Hay figuritas repetidas marcadas tambien como faltantes: ${conflicts.slice(0, 10).join(", ")}`,
    );
  }

  return {
    missing,
    duplicates,
    ignoredLines: [...missing.ignoredLines, ...duplicates.ignoredLines],
  };
}

function buildCountsFromExternalText(payload, catalogKeys = getWorldCup2026CatalogKeys()) {
  const parsed = parseExternalStickerText(payload, { requireMissing: true });
  const missingKeys = new Set(parsed.missing.items.map((item) => item.stickerKey));
  const catalog = new Set(catalogKeys);
  const counts = {};

  for (const stickerKey of catalog) {
    if (!missingKeys.has(stickerKey)) {
      counts[stickerKey] = 1;
    }
  }

  for (const duplicate of parsed.duplicates.items) {
    counts[duplicate.stickerKey] = Math.min(
      99,
      Math.max(counts[duplicate.stickerKey] || 1, 1 + duplicate.quantity),
    );
  }

  return {
    counts,
    parsed,
    summary: {
      catalogCount: catalog.size,
      missingCount: parsed.missing.items.length,
      duplicateStickerCount: parsed.duplicates.items.length,
      duplicateCopies: parsed.duplicates.items.reduce((total, item) => total + item.quantity, 0),
      ownedCount: Object.keys(counts).length,
    },
  };
}

function stickerItemFromKey(stickerKey, extra = {}) {
  return {
    ...getStickerParts(stickerKey),
    ...extra,
  };
}

function compareCountsWithExternalText(counts, payload) {
  const parsed = parseExternalStickerText(payload);
  const iHaveForThem = [];
  const iNeedFromThem = [];

  for (const item of parsed.missing.items) {
    const count = Number(counts[item.stickerKey] || 0);

    if (count > 1) {
      iHaveForThem.push(
        stickerItemFromKey(item.stickerKey, {
          count,
          available: count - 1,
        }),
      );
    }
  }

  for (const item of parsed.duplicates.items) {
    const count = Number(counts[item.stickerKey] || 0);

    if (count === 0) {
      iNeedFromThem.push(
        stickerItemFromKey(item.stickerKey, {
          theirAvailable: item.quantity,
        }),
      );
    }
  }

  iHaveForThem.sort(compareStickerItems);
  iNeedFromThem.sort(compareStickerItems);

  return {
    parsed,
    iHaveForThem,
    iNeedFromThem,
    summary: {
      theirMissingCount: parsed.missing.items.length,
      theirDuplicateStickerCount: parsed.duplicates.items.length,
      iHaveForThemCount: iHaveForThem.length,
      iNeedFromThemCount: iNeedFromThem.length,
    },
  };
}

module.exports = {
  buildCountsFromExternalText,
  compareCountsWithExternalText,
  getWorldCup2026CatalogKeys,
  parseExternalStickerText,
};
