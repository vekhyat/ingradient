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
    barcodeHelper: 'The digits under the barcode, without spaces.',
    printedAs: (printed: string) => `Printed as: ${printed}`,
    barcodeErrors: {
      empty: 'Enter the digits under the barcode.',
      invalid_chars: 'Use digits only.',
      invalid_length: 'Barcodes have 8, 12, 13 or 14 digits.',
      invalid_checksum:
        'These digits do not make a valid barcode. Check the last digit.',
      too_long: 'That is too many digits for a barcode.',
    },
    transcriptionErrors: {
      empty: 'Type what the label says, or use "Can\'t read".',
      unit_required: 'Add the unit printed on the label, such as g.',
      basis_required:
        'Say whether this is per 100 g, per 100 ml or per serving.',
    },
  },

  sheet: {
    discardTitle: 'Discard changes?',
    discardBody: 'Your edits to this field will be lost.',
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
    fromPack: 'read from the pack',
    fromOff: 'from Open Food Facts',
  },

  identity: {
    nameMissing: 'Name not on this record',
    fromOff: 'From the barcode, Open Food Facts',
    fromLabel: 'From your label photo',
    fromMixed: 'From Open Food Facts and your label photo',
    offCredit:
      'Product facts: Open Food Facts contributors, Open Database Licence (ODbL).',
    offPhotoCredit: (creator: string | null) =>
      `Photo: ${creator ?? 'Open Food Facts contributor'}, CC BY-SA. Packaging design may belong to the brand.`,
    inspectSource: 'Where this came from',
    barcode: (code: string) => `Barcode ${code}`,
  },

  assessment: {
    productGrade: 'Product grade',
    methodLabel: 'Nutrition grade · European reference',
    noGrade: 'No product grade',
    insufficientTitle: 'Not enough information to grade',
    methodUnavailableTitle: 'No grade yet',
    unsupportedTitle: 'Not graded',
    personalUnavailable: 'Personal assessment unavailable',
    checkingRequirements: 'Checking your requirements',
    updateAvailable: 'Updated analysis available',
    updateSame: "Same grade, reasons from the server's resources",
    updateOpen: 'Open update',
    skip: 'Skip animation',
    collapsedName: (text: string, expanded: boolean) =>
      `${text}, ${expanded ? 'expanded' : 'collapsed'}`,
  },

  reasons: {
    title: 'Why this grade',
    openSource: (title: string) => `Source: ${title}`,
    inputs: (text: string) => `Uses: ${text}`,
    unavailable: 'No cited reason is available for this result.',
  },

  source: {
    issuer: 'Published by',
    edition: 'Edition',
    locator: 'Where in the document',
    claim: 'What it supports',
    limitation: 'Limits',
    openOriginal: 'Open the original',
    metadataOnly:
      'The original document is not stored on this phone. These details still identify it.',
    retired:
      'This source was used for an older result. New results use a newer reviewed edition.',
    error: 'The source details could not be loaded.',
    offline: 'You are offline. The original will open when you reconnect.',
    badLink: 'This link cannot be opened safely.',
  },

  ingredients: {
    title: 'Ingredients',
    countInOrder: (count: number) =>
      `${pluralise(count, 'ingredient', 'ingredients')}, in pack order`,
    all: (count: number) => `All ${count} ingredients`,
    missing: 'No ingredient list on this record. A label photo can add it.',
    loading: 'Reading ingredients…',
    error: 'The ingredient list could not be read.',
    unresolved: 'Not matched to a known ingredient yet',
    ambiguous: 'Could match more than one ingredient',
    matched: 'Matched',
    within: (parent: string) => `Part of ${parent}`,
  },

  nutrition: {
    title: 'Nutrition',
    unknown: 'Unknown',
    none: 'No nutrition table on this record. A label photo can add it.',
  },

  status: {
    lookup: {
      pending: 'Looking up this barcode',
      invalid_code: 'That is not a valid barcode. Check the digits.',
      absent:
        'This product is not in Open Food Facts yet. Photograph the label instead.',
      offline:
        'You are offline. Barcode lookup needs a connection. Label photos work offline.',
      timeout: 'The lookup took too long. Try again.',
      throttled: (seconds: number | null) =>
        seconds
          ? `Too many lookups in a short time. Try again in ${seconds} seconds.`
          : 'Too many lookups in a short time. Try again shortly.',
      upstream_unavailable:
        'Open Food Facts is not responding right now. Try again later.',
      malformed:
        'Open Food Facts sent data the app could not read. Try again or photograph the label.',
      cancelled: 'Lookup cancelled.',
      incomplete:
        'Found this product, but its record is missing the facts needed for a grade. Photograph the label to add them.',
    },
    capture: {
      pending: 'Taking the photo',
      failed: 'The photo could not be taken. Try again.',
    },
    reading: {
      pending: 'Reading the label',
      noText:
        'No text was found in this photo. Try again with the label filling the frame.',
      unsupportedLanguage:
        'This label is not in English. This version reads English labels only.',
      engineError: 'The text reader on this phone failed. Try again.',
    },
    matching: { pending: 'Matching ingredients' },
    analysis: {
      server: 'Analysing',
      phone: 'Analysing on this phone',
      failed: 'The analysis did not finish. Your facts are still here.',
    },
    saving: {
      pending: 'Saving on this phone',
      done: 'Saved on this phone',
      failed: 'Could not save on this phone. The result is still here.',
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
    pointAtEither: 'Point at a barcode, or photograph the label',
    barcodeDetected: 'Barcode detected',
    noBarcodeTitle: 'Barcode or label, one camera',
    noBarcodeBody:
      'A barcode is read as soon as it is in view. No barcode, or no data for it? Tap the shutter to photograph the ingredients and nutrition table; one photo can hold both.',
    startOver: 'Start over',
    photographLabel: 'Photograph the label',
    typeBarcode: 'Type the barcode',
    manualTitle: 'Type the barcode',
    lookUp: 'Look up',
    cameraStarting: 'Starting the camera',
    cameraInterrupted: 'The camera stopped. Return to the app to restart it.',
    cameraUnavailable: 'No camera is available. You can still type a barcode.',
    permissionTitle: 'Camera access',
    permissionBody:
      'Ingradient needs the camera to read barcodes and labels. Photos stay on this phone.',
    permissionAllow: 'Allow camera',
    permissionBlocked:
      'Camera access is off for Ingradient. Turn it on in Settings, or type a barcode.',
    openSettings: 'Open Settings',
  },

  capture: {
    title: 'Photograph the label',
    hint: 'Fit the ingredients and the nutrition table in the frame. One photo can hold both.',
    shutter: 'Take photo',
    panels: {
      ingredients: 'Ingredients',
      nutrition: 'Nutrition table',
    },
    panelState: {
      read: 'Read',
      uncertain: 'Read, needs a check',
      missing: 'Still needed',
      user_marked_absent: 'Not on this pack',
    },
    needOther: (panel: string) => `Now photograph the ${panel.toLowerCase()}.`,
    neither:
      'Neither the ingredients nor a nutrition table was found. Try another photo.',
    markAbsent: (panel: string) => `This pack has no ${panel.toLowerCase()}`,
    retake: (panel: string) => `Retake ${panel.toLowerCase()}`,
    continue: 'Continue',
    discardTitle: 'Discard this label?',
    discardBody:
      'The photos and text read so far will be removed from this phone.',
  },

  review: {
    title: 'Check the text',
    intro:
      'This is what the app read. Fix anything that does not match the pack. You do not need to confirm each row.',
    analyse: 'Analyse available information',
    discard: 'Discard',
    edit: (what: string) => `Edit ${what}`,
    correctionTitle: (what: string) => `Correct ${what}`,
    apply: 'Apply',
    cantRead: "Can't read",
    cantReadDone: 'Marked as unreadable',
    retake: 'Retake this part',
    noIngredients: 'No ingredients were read.',
    noNutrients: 'No nutrition values were read.',
    valueLabel: 'Value',
    ingredientLabel: 'Ingredient as printed',
  },

  result: {
    title: 'Product',
    save: 'Save on this phone',
    saved: 'Saved on this phone',
    method: 'How this was assessed',
    analysedOnServer: 'Analysed on the server',
    analysedOnPhone: 'Analysed on this phone',
    savedOn: (date: string) => `Saved ${date}`,
    productAlone: 'About the product alone',
    photographToFill: 'Photograph label',
  },

  method: {
    title: 'Method',
    noMethod:
      'The grading method is not installed in this build yet, so no letter is shown. Product facts, ingredients and nutrition are still shown with their sources.',
    notOfficial:
      'This is the app’s assessment using a published European method. It is not an official Indian grade and is not endorsed by FSSAI or Santé publique France.',
    edition: (edition: string) => `Edition: ${edition}`,
    gaps: 'What is missing',
  },

  history: {
    title: 'History',
    empty: 'Nothing saved yet. Results you save on this phone appear here.',
    loading: 'Opening saved results',
    error:
      'Saved results could not be read from this phone. They have not been deleted.',
    deleteAction: (name: string) => `Delete ${name}`,
    deleteTitle: (name: string) => `Delete ${name}?`,
    deleteBody:
      'This removes the saved result from this phone. It cannot be undone.',
    deleteConfirm: 'Delete',
    deleteFailed: 'Could not delete. The saved result is still on this phone.',
    productKind: 'Product alone',
    savedAt: (date: string) => `Saved ${date}`,
    noGrade: 'No grade',
  },

  you: {
    title: 'You',
    localTitle: 'What stays on this phone',
    localBody:
      'Saved results, label photos while you check them, and any corrections you make stay on this phone. Saved results are encrypted.',
    requestsTitle: 'What leaves this phone',
    requestsBody:
      'A barcode lookup sends the barcode to Open Food Facts. Opening a source sends you to that website. Label photos are never uploaded.',
    savedCount: (count: number) =>
      `${pluralise(count, 'saved result', 'saved results')} on this phone`,
    erase: 'Erase saved results',
    erasing: 'Erasing',
    eraseTitle: 'Erase all saved results?',
    eraseBody:
      'This deletes every saved result on this phone. Copies in old phone backups made by the system are outside the app’s reach.',
    eraseConfirm: 'Erase',
    eraseFailed:
      'Not everything could be erased. Some saved results are still on this phone. Try again.',
    erased: 'Saved results erased from this phone.',
    privacy: 'Privacy notice',
    method: 'How grades work',
    profileLater: 'Allergy and preference settings arrive in a later version.',
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
