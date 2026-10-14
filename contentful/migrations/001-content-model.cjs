// The initial content model (ARCHITECTURE.md §5.2): 12 of the free tier's 25 content types.
// Run against the `dev` environment first:
//
//   pnpm dlx contentful-migration --space-id <id> --environment-id dev --access-token <cma-token> contentful/migrations/001-content-model.cjs
//
// Closed lists come from contentful/vocab.json, generated from code (`pnpm content:vocab`).
// Later model changes are new numbered migrations, written expand-then-contract (§5.4).

const vocab = require('../vocab.json')

const key = { regexp: { pattern: vocab.keyPattern, flags: null } }
const oneOf = values => ({ in: values })
const linkTo = types => ({ linkContentType: types })

/** A readable key (§5.3): unique, validated against the code's pattern. */
function keyField(type) {
  type.createField('key').name('Key').type('Symbol').required(true).validations([{ unique: true }, key])
}

function entryLink(type, id, name, types, required = false) {
  return type.createField(id).name(name).type('Link').linkType('Entry').required(required).validations([linkTo(types)])
}

function entryLinks(type, id, name, types, size) {
  const field = type.createField(id).name(name).type('Array').items({ type: 'Link', linkType: 'Entry', validations: [linkTo(types)] })
  if (size) field.validations([{ size }])
  return field
}

function imageLink(type, id, name) {
  return type.createField(id).name(name).type('Link').linkType('Asset').validations([{ linkMimetypeGroup: ['image'] }])
}

/** Inline call to action (§5.3): a label plus target references, or an external URL. */
function actionFields(type) {
  type.createField('actionLabel').name('Action label').type('Symbol').validations([{ size: { max: 40 } }])
  entryLinks(type, 'actionTarget', 'Action target', vocab.actionTargetTypes, { max: 4 })
  type.createField('actionUrl').name('Action URL (external)').type('Symbol').validations([{ regexp: { pattern: '^https://\\S+$', flags: null } }])
}

/** Restricted Rich Text (D13): formatting plus links to other entries only. */
function restrictedRichText(type, id, name) {
  return type.createField(id).name(name).type('RichText').validations([
    { enabledNodeTypes: ['heading-2', 'heading-3', 'unordered-list', 'ordered-list', 'hr', 'entry-hyperlink'] },
    { enabledMarks: ['bold', 'italic'] },
    { nodes: { 'entry-hyperlink': [linkTo(vocab.richTextLinkTypes)] } },
  ])
}

const internalName = type => type.createField('internalName').name('Internal name').type('Symbol').required(true)

module.exports = function (migration) {
  // --- Catalog -------------------------------------------------------------

  const concept = migration.createContentType('concept').name('Concept').displayField('label')
    .description('Discovery and AI grounding only; the engine never reads concepts.')
  keyField(concept)
  concept.createField('label').name('Label').type('Symbol').required(true)
  concept.createField('facet').name('Facet').type('Symbol').required(true).validations([oneOf(vocab.conceptFacets)])
  concept.createField('synonyms').name('Synonyms').type('Array').items({ type: 'Symbol' })
  concept.createField('description').name('Description').type('Text')

  const ability = migration.createContentType('ability').name('Ability').displayField('name')
  keyField(ability)
  ability.createField('name').name('Name').type('Symbol').required(true)
  ability.createField('kind').name('Kind').type('Symbol').required(true).validations([oneOf(vocab.abilityKinds)])
  ability.createField('description').name('Description').type('Text')

  const character = migration.createContentType('character').name('Character').displayField('name')
    .description('Engine fields use closed lists from code. Retire instead of unpublishing.')
  keyField(character)
  character.createField('formerKeys').name('Former keys').type('Array').items({ type: 'Symbol', validations: [key] })
  character.createField('status').name('Status').type('Symbol').required(true).validations([oneOf(['active', 'retired'])])
  character.createField('name').name('Name').type('Symbol').required(true)
  character.createField('epithet').name('Epithet').type('Symbol')
  imageLink(character, 'portrait', 'Portrait')
  character.createField('bounty').name('Bounty').type('Integer').validations([{ range: { min: 0 } }])
  for (const { stat, field } of vocab.stats) {
    character.createField(field).name(`Stat: ${stat}`).type('Integer').required(true).validations([{ range: vocab.statRange }])
  }
  character.createField('roles').name('Roles').type('Array').items({ type: 'Symbol', validations: [oneOf(vocab.roles)] }).validations([{ size: { min: 1, max: 3 } }])
  character.createField('powerType').name('Power type').type('Symbol').required(true).validations([oneOf(vocab.powerTypes)])
  character.createField('faction').name('Faction (current canon)').type('Symbol').required(true).validations([oneOf(vocab.factions)])
  character.createField('haki').name('Haki').type('Array').items({ type: 'Symbol', validations: [oneOf(vocab.haki)] })
  entryLinks(character, 'concepts', 'Concepts', ['concept'])
  entryLinks(character, 'abilities', 'Abilities', ['ability'])

  const objective = migration.createContentType('objective').name('Objective').displayField('name')
    .description('Stat weights and required positions: intent the engine can rank by.')
  keyField(objective)
  objective.createField('name').name('Name').type('Symbol').required(true)
  for (const { stat, weightField } of vocab.stats) {
    objective.createField(weightField).name(`Weight: ${stat}`).type('Integer').validations([{ range: vocab.weightRange }])
  }
  objective.createField('requiredPositions').name('Required positions').type('Array').items({ type: 'Symbol', validations: [oneOf(vocab.positions)] })
  entryLinks(objective, 'concepts', 'Goal concepts', ['concept'])

  const preset = migration.createContentType('crewPreset').name('Crew preset').displayField('name')
    .description('One reference per seat. Captain is required; a character may appear once.')
  keyField(preset)
  preset.createField('name').name('Name').type('Symbol').required(true)
  preset.createField('description').name('Description').type('Text')
  for (const seat of vocab.presetSeats) {
    entryLink(preset, seat.field, seat.label, ['character'], seat.position === 'captain')
  }
  entryLinks(preset, 'concepts', 'Concepts', ['concept'])

  // --- Blocks ----------------------------------------------------------------

  const featureItem = migration.createContentType('featureItem').name('Feature item').displayField('title')
  featureItem.createField('title').name('Title').type('Symbol').required(true)
  featureItem.createField('body').name('Body').type('Text')
  featureItem.createField('icon').name('Icon').type('Symbol')

  const hero = migration.createContentType('blockHero').name('Block: hero').displayField('internalName')
  internalName(hero)
  hero.createField('headline').name('Headline').type('Symbol').required(true)
  hero.createField('subheadline').name('Subheadline').type('Symbol')
  imageLink(hero, 'image', 'Image')
  entryLink(hero, 'featuredCharacter', 'Featured character', ['character'])
  actionFields(hero)

  const grid = migration.createContentType('blockFeatureGrid').name('Block: feature grid').displayField('internalName')
  internalName(grid)
  grid.createField('heading').name('Heading').type('Symbol').required(true)
  grid.createField('intro').name('Intro').type('Text')
  entryLinks(grid, 'items', 'Items', ['featureItem', 'character', 'ability', 'crewPreset'], { min: 1, max: 12 }).required(true)
  actionFields(grid)

  const cta = migration.createContentType('blockCta').name('Block: call to action').displayField('internalName')
  internalName(cta)
  cta.createField('heading').name('Heading').type('Symbol').required(true)
  restrictedRichText(cta, 'body', 'Body')
  actionFields(cta)

  const testimonial = migration.createContentType('blockTestimonial').name('Block: testimonial').displayField('internalName')
    .description('Quotes are authored, never generated. Use a speaker or an attribution, not both.')
  internalName(testimonial)
  testimonial.createField('quote').name('Quote').type('Text').required(true)
  entryLink(testimonial, 'speaker', 'Speaker', ['character'])
  testimonial.createField('attribution').name('Attribution').type('Symbol')
  testimonial.createField('context').name('Context').type('Symbol')

  // --- Pages and settings ------------------------------------------------------

  const page = migration.createContentType('page').name('Journey page').displayField('title')
    .description('Journey pages only; app routes compose their blocks in code.')
  page.createField('title').name('Title').type('Symbol').required(true)
  page.createField('slug').name('Slug').type('Symbol').required(true).validations([{ unique: true }, { regexp: { pattern: vocab.slugPattern, flags: null } }])
  entryLinks(page, 'blocks', 'Blocks', vocab.blockTypes, { min: 1, max: 12 }).required(true)
  entryLinks(page, 'concepts', 'Concepts', ['concept'])
  page.createField('seoTitle').name('SEO title').type('Symbol')
  page.createField('seoDescription').name('SEO description').type('Symbol').validations([{ size: { max: 160 } }])
  page.createField('indexable').name('Indexable').type('Boolean')

  const settings = migration.createContentType('siteSettings').name('Site settings').displayField('internalName')
    .description('Exactly one entry. Crew-name words never include character names.')
  internalName(settings)
  entryLinks(settings, 'navigation', 'Navigation', ['page'], { max: 8 })
  settings.createField('footerText').name('Footer text').type('Text')
  settings.createField('namePatterns').name('Crew name patterns').type('Array')
    .items({ type: 'Symbol', validations: [{ regexp: { pattern: '^[^{}]*(\\{(adjective|noun)\\}[^{}]*)+$', flags: null } }] })
  const word = { type: 'Symbol', validations: [{ regexp: { pattern: '^[A-Za-z][A-Za-z\' -]{0,23}$', flags: null } }] }
  settings.createField('nameAdjectives').name('Crew name adjectives').type('Array').items(word)
  settings.createField('nameNouns').name('Crew name nouns').type('Array').items(word)
}
