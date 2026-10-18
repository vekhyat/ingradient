/**
 * All visible English text. Components read from here so wording can be
 * reviewed in one place. Health and method wording follows DESIGN-LANGUAGE
 * §1 and §6: no "safe", "avoid" or "optimal", and no claim of an official
 * Indian grade.
 */

const pluralise = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

export const enGB = {
  appName: 'Ingradient',

  nav: {
    scan: 'Scan',
    history: 'History',
    you: 'You',
  },

  common: {
    back: 'Back',
    close: 'Close',
    retry: 'Try again',
    cancel: 'Cancel',
    open: 'Open',
    unavailable: 'Unavailable',
  },

  field: {
    clear: 'Clear',
    barcodePlaceholder: '8 901234 567890',
    barcodeHelper: 'The digits under the barcode.',
    printedAs: (printed: string) => `Printed as: ${printed}`,
    barcodeErrors: {
      empty: 'Enter the digits under the barcode.',
      invalid_chars: 'Use digits only.',
      invalid_length: 'Barcodes have 8, 12, 13 or 14 digits.',
      invalid_checksum: 'Not a valid barcode. Check the last digit.',
      too_long: 'Too many digits for a barcode.',
    },
    transcriptionErrors: {
      empty: 'Type what the label says, or use "Can\'t read".',
      unit_required: 'Add the unit printed on the label, such as g.',
      basis_required: 'Per 100 g, per 100 ml or per serving?',
    },
  },

  sheet: {
    discardTitle: 'Discard changes?',
    discardBody: 'Your edits will be lost.',
    keepReviewing: 'Keep reviewing',
    discard: 'Discard',
  },

  grade: {
    name: (letter: string) => `Product grade ${letter}`,
  },

  provenance: {
    check: 'Check',
    corrected: 'You corrected this transcription',
    estimated: 'Estimated',
    estimatedBy: {
      'openfoodfacts-ingredients-analysis':
        'by Open Food Facts from the ingredient list',
    } as Record<string, string>,
    fromPack: 'read from the pack',
    fromOff: 'from Open Food Facts',
  },

  identity: {
    nameMissing: 'Name not on this record',
    labelOnlyName: 'Product from your label photo',
    fromOff: 'Open Food Facts',
    fromLabel: 'Your label photo',
    fromMixed: 'Open Food Facts + your label photo',
    offCredit: '© Open Food Facts contributors, ODbL',
    offPhotoCredit: (creator: string | null) =>
      `Photo: ${creator ?? 'Open Food Facts contributor'}, CC BY-SA.`,
    inspectSource: 'Where this came from',
    barcode: (code: string) => `Barcode ${code}`,
  },

  assessment: {
    productGrade: 'Product grade',
    methodLabel: 'Nutrition grade · European reference',
    noGrade: 'No product grade',
    nutritionGrade: 'Nutrition grade',
    insufficientTitle: 'Not enough data for a grade',
    methodUnavailableTitle: 'No grade yet',
    unsupportedTitle: 'Not graded',
    personalUnavailable: 'Personal assessment unavailable',
    checkingRequirements: 'Checking your requirements',
    updateAvailable: 'Update available',
    updateSame: 'Same grade, updated reasons',
    updateOpen: 'Open update',
    skip: 'Skip',
    collapsedName: (text: string, expanded: boolean) =>
      `${text}, ${expanded ? 'expanded' : 'collapsed'}`,
  },

  reasons: {
    title: 'Why this grade',
    openSource: (title: string) => `Source: ${title}`,
    inputs: (text: string) => `Uses: ${text}`,
    unavailable: 'No cited reason available.',
  },

  source: {
    issuer: 'Published by',
    edition: 'Edition',
    locator: 'Where in the document',
    claim: 'What it supports',
    limitation: 'Limits',
    openOriginal: 'Open the original',
    metadataOnly: 'The original is not stored on this phone.',
    retired: 'Older edition. New results use a newer one.',
    error: 'The source details could not be loaded.',
    offline: 'You are offline. Try again when connected.',
    badLink: 'This link cannot be opened.',
  },

  ingredients: {
    title: 'Ingredients',
    countInOrder: (count: number) =>
      `${pluralise(count, 'ingredient', 'ingredients')} in pack order`,
    all: (count: number) => `All ${count} ingredients`,
    missing: 'No ingredient list. Photograph the label to add it.',
    loading: 'Reading ingredients…',
    error: 'The ingredient list could not be read.',
    unresolved: 'Not matched yet',
    ambiguous: 'More than one match',
    matched: 'Matched',
    within: (parent: string) => `Part of ${parent}`,
  },

  facts: {
    title: 'What the pack says',
    listedFirst: 'Listed first',
    additives: (count: number) =>
      count === 1 ? '1 additive' : `${count} additives`,
    noAdditives: 'No additives listed',
    unknownAdditive: 'Unknown additive',
    contains: 'Contains',
    mayContain: 'May contain',
    declared: 'Amounts on the pack',
    none: 'No ingredient list yet. Photograph it to add one.',
  },

  addNutrition: {
    title: 'Add the nutrition table?',
    body: 'A grade needs the nutrition table.',
    action: 'Add nutrition table',
  },

  nutrition: {
    title: 'Nutrition',
    kcal: (value: number) => `${value} kcal`,
    unknown: 'Unknown',
    none: 'No nutrition table. Photograph it to add one.',
  },

  status: {
    lookup: {
      pending: 'Looking up barcode',
      invalid_code: 'Not a valid barcode. Check the digits.',
      absent: 'Product not found. Photograph the label instead.',
      offline: 'You are offline. Photograph the label instead.',
      timeout: 'Lookup took too long. Try again.',
      throttled: (seconds: number | null) =>
        seconds
          ? `Too many lookups. Try again in ${seconds} s.`
          : 'Too many lookups. Try again shortly.',
      upstream_unavailable: 'Open Food Facts is not responding. Try later.',
      malformed: 'Could not read the product data. Try again.',
      cancelled: 'Lookup cancelled.',
      incomplete: 'Product found, but data is missing. Photograph the label.',
    },
    capture: {
      pending: 'Taking photo',
      failed: 'Photo failed. Try again.',
    },
    reading: {
      pending: 'Reading the label',
      noText: 'No text found. Fill the frame with the label.',
      unsupportedLanguage: 'Only English labels are supported for now.',
      engineError: 'Could not read the text. Try again.',
    },
    matching: { pending: 'Matching ingredients' },
    analysis: {
      server: 'Analysing',
      phone: 'Analysing on this phone',
      failed: 'Analysis failed. Try again.',
    },
    saving: {
      pending: 'Saving on this phone',
      done: 'Saved on this phone',
      failed: 'Could not save. Try again.',
    },
    photographLabel: 'Photograph label',
  },

  scan: {
    title: 'Scan',
    barcodeMode: 'Barcode',
    labelMode: 'Label',
    torchOn: 'Torch on',
    torchOff: 'Torch off',
    findProduct: 'Find a product',
    pointAtBarcode: 'Point at the barcode',
    pointAtEither: 'Photograph the ingredients',
    barcodeAuto: 'or point at a barcode',
    barcodeDetected: 'Barcode detected',
    noBarcodeTitle: 'Photograph the ingredients',
    noBarcodeBody: 'Fill the frame with the ingredient list.',
    startOver: 'Start over',
    photographLabel: 'Photograph the label',
    typeBarcode: 'Type the barcode',
    manualTitle: 'Type the barcode',
    lookUp: 'Look up',
    cameraStarting: 'Starting the camera',
    focusCamera: 'Focus camera',
    focusHint: 'Double tap to focus.',
    cameraInterrupted: 'Camera paused.',
    cameraUnavailable: 'No camera. You can type a barcode.',
    permissionTitle: 'Camera access',
    permissionBody:
      'Needed to scan barcodes and labels. Photos stay on this phone.',
    permissionAllow: 'Allow camera',
    permissionBlocked:
      'Camera is off. Turn it on in Settings, or type a barcode.',
    openSettings: 'Open Settings',
  },

  capture: {
    title: 'Photograph the label',
    hint: 'Fill the frame with the text',
    ingredientsRead: 'Ingredients read. Add the nutrition table for a grade.',
    seeResults: 'See results',
    shutter: 'Take photo',
    panels: {
      ingredients: 'Ingredients',
      nutrition: 'Nutrition table',
    },
    panelState: {
      read: 'Read',
      uncertain: 'Check',
      missing: 'Needed',
      user_marked_absent: 'Not on pack',
    },
    needOther: (panel: string) => `Now photograph the ${panel.toLowerCase()}.`,
    neither: 'No ingredients or nutrition table found. Try again.',
    markAbsent: (panel: string) => `This pack has no ${panel.toLowerCase()}`,
    retake: (panel: string) => `Retake ${panel.toLowerCase()}`,
    continue: 'Continue',
    discardTitle: 'Discard this label?',
    discardBody: 'The photos and text will be deleted.',
  },

  review: {
    title: 'Check the text',
    intro: 'Fix anything that does not match the pack.',
    analyse: 'See results',
    discard: 'Discard',
    edit: (what: string) => `Edit ${what}`,
    correctionTitle: (what: string) => `Correct ${what}`,
    apply: 'Apply',
    cantRead: "Can't read",
    cantReadDone: 'Unreadable',
    retake: 'Retake',
    noIngredients: 'No ingredients read.',
    noNutrients: 'No nutrition values read.',
    valueLabel: 'Value',
    ingredientLabel: 'Ingredient as printed',
  },

  result: {
    title: 'Result',
    save: 'Save',
    saved: 'Saved on this phone',
    analysedOnServer: 'Analysed on the server',
    analysedOnPhone: 'Analysed on this phone',
    savedOn: (date: string) => `Saved ${date}`,
    productAlone: 'About the product alone',
    photographToFill: 'Photograph label',
  },

  method: {
    title: 'Method',
    noMethod:
      'The grading method is not in this build yet, so no letter is shown.',
    notOfficial:
      'Uses a published European method. Not an official Indian grade; not endorsed by FSSAI or Santé publique France.',
    edition: (edition: string) => `Edition: ${edition}`,
    gaps: 'What is missing',
  },

  history: {
    title: 'History',
    empty: 'Nothing saved yet.',
    loading: 'Opening saved results',
    error: 'Could not open saved results. Nothing was deleted.',
    deleteAction: (name: string) => `Delete ${name}`,
    deleteTitle: (name: string) => `Delete ${name}?`,
    deleteBody: 'This cannot be undone.',
    deleteConfirm: 'Delete',
    deleteFailed: 'Could not delete. Try again.',
    productKind: 'Product alone',
    savedAt: (date: string) => `Saved ${date}`,
    noGrade: 'No grade',
  },

  you: {
    title: 'You',
    localTitle: 'Stays on this phone',
    localBody: 'Saved results, label photos and your corrections. Encrypted.',
    requestsTitle: 'Leaves this phone',
    requestsBody:
      'Barcodes go to Open Food Facts. Sources open their own website. Label photos are never uploaded.',
    savedCount: (count: number) =>
      pluralise(count, 'saved result', 'saved results'),
    erase: 'Erase saved results',
    erasing: 'Erasing',
    eraseTitle: 'Erase all saved results?',
    eraseBody:
      'Deletes every saved result. Earlier system backups are not affected.',
    eraseConfirm: 'Erase',
    eraseFailed: 'Some results could not be erased. Try again.',
    erased: 'Saved results erased.',
    privacy: 'Privacy notice',
    method: 'How grades work',
    profileLater: 'Allergy settings coming soon.',
  },

  /**
   * Phone-side copy for gaps the analysis server names by code (BE-12
   * catalogue, 2026-10-18). The server's own message is never shown.
   */
  backendIssue: {
    unknown: 'The analysis server reported a gap this app cannot describe.',
    nutrientLabel: {
      energy: 'energy',
      sugars: 'total sugars',
      saturates: 'saturated fat',
      salt: 'salt',
      protein: 'protein',
      fibre: 'fibre',
      fat: 'total fat',
      fvl: 'fruit, vegetables and legumes',
    },
    missing: (label: string) => `No usable ${label} value was found.`,
    conflicting: (label: string) =>
      `More than one ${label} value was found, so none was used.`,
    unsupportedBasis: (label: string) =>
      `The ${label} value is not given per 100 g, or per 100 ml for drinks, in the expected unit.`,
    invalid: (label: string) =>
      `The ${label} value is outside the possible range.`,
    unusable: (label: string) =>
      `The ${label} value is uncertain or needs checking, so it was not used.`,
    fixed: {
      unsupported_category:
        'The grading method does not cover this kind of product.',
      conflicting_scoring_facts:
        'The facts about what kind of product this is contradict each other.',
      missing_cheese:
        'It is not known whether this product is a cheese, which changes how it is graded.',
      missing_redmeat:
        'It is not known whether this product contains red meat, which changes how it is graded.',
      missing_plainwater: 'It is not known whether this drink is plain water.',
      sweetener_presence_unknown:
        'It is not known whether this drink contains a non-nutritive sweetener.',
      conflicting_water_facts:
        'This product is marked as plain water but lists nutrients.',
      inconsistent_fat: 'Saturated fat is listed as higher than total fat.',
      method_score_out_of_bounds:
        'The grading method gave a result outside its range, so no grade is shown.',
      unsupported_method_resource:
        'The grading method could not be applied to this product.',
      incompatible_resources:
        'The analysis server uses a different method edition from this app.',
      missing_category_provenance:
        'The product type has no source, so the right grading rules cannot be chosen.',
      candidate_method_not_released:
        'The grading method is not available on the analysis server yet.',
      allergen_statement_separate:
        "The pack's Contains or May contain statement is kept separate from the ingredients.",
      ingredients_unavailable: 'No ingredient list was available.',
      ingredient_structure_unresolved:
        'The ingredient list could not be split into separate ingredients.',
      ingredients_incomplete: 'The ingredient list may be incomplete.',
      ingredient_identity_unresolved:
        'Some ingredients could not be identified.',
    },
  },

  onboarding: {
    title: 'Before you start',
    draftMarker: 'Draft notice, version 1 — not yet legally reviewed',
    body: [
      'Ingradient reads food labels and barcodes to show what is in packaged food, with sources for every reason.',
      'When analysis runs on our server, the product text and nutrition values are sent there. In this build, the server does not store them.',
      'Your photos, saved results, allergies and preferences are never sent. They stay on this phone.',
      'Barcode lookups go to Open Food Facts, a public food database.',
    ],
    accept: 'Continue',
    failed: 'Could not record your choice on this phone. Try again.',
  },
} as const;
