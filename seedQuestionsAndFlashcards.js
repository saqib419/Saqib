// Seeds Question + Flashcard collections with real NEET UG content for
// Physics, Chemistry, and Biology. Safe to re-run — upserts by matching
// subject + text, never duplicates.
//
// Requires scripts/seedCurriculum.js to have been run first (needs the
// Subject/Chapter documents to exist so questions/flashcards can link to them).
//
// Usage:
//   MONGO_URI="your_connection_string" node scripts/seedQuestionsAndFlashcards.js

require('dotenv').config();
const mongoose = require('mongoose');
const Subject   = require('../models/Subject');
const Chapter   = require('../models/Chapter');
const Question  = require('../models/Question');
const Flashcard = require('../models/Flashcard');

const EXAM_GROUP = 'NEET_UG';

// ── Questions: [subjectName, chapterTitle-or-null, text, options{A-D}, correctKey, explanation, difficulty] ──
const QUESTIONS = {
  Physics: [
    {
      chapter: 'Units and Measurements',
      text: 'What is the SI unit of electric current?',
      options: { A: 'Volt', B: 'Ampere', C: 'Ohm', D: 'Coulomb' },
      correctKey: 'B',
      explanation: 'The ampere (A) is the SI base unit of electric current, defined via the flow of electric charge.',
      difficulty: 'easy',
    },
    {
      chapter: 'Laws of Motion',
      text: "Newton's third law states that for every action there is:",
      options: { A: 'An equal and opposite reaction', B: 'A proportional reaction', C: 'No reaction', D: 'A delayed reaction' },
      correctKey: 'A',
      explanation: "Newton's third law: for every action, there is an equal and opposite reaction, acting on different bodies.",
      difficulty: 'easy',
    },
    {
      chapter: 'Work, Energy and Power',
      text: 'The SI unit of power is:',
      options: { A: 'Joule', B: 'Newton', C: 'Watt', D: 'Pascal' },
      correctKey: 'C',
      explanation: 'Power is the rate of doing work; its SI unit is the watt (W), equal to one joule per second.',
      difficulty: 'easy',
    },
    {
      chapter: 'Current Electricity',
      text: "According to Ohm's law, the current through a conductor is:",
      options: { A: 'Inversely proportional to voltage', B: 'Directly proportional to voltage, at constant temperature', C: 'Independent of voltage', D: 'Proportional to the square of voltage' },
      correctKey: 'B',
      explanation: "Ohm's law: V = IR, so current is directly proportional to voltage when resistance and temperature are constant.",
      difficulty: 'medium',
    },
    {
      chapter: 'Electromagnetic Induction',
      text: "Faraday's law of electromagnetic induction relates induced EMF to:",
      options: { A: 'The rate of change of magnetic flux', B: 'The resistance of the coil', C: 'The temperature of the conductor', D: 'The mass of the coil' },
      correctKey: 'A',
      explanation: 'Faraday\u2019s law states induced EMF equals the negative rate of change of magnetic flux through a circuit.',
      difficulty: 'medium',
    },
    {
      chapter: 'Gravitation',
      text: "The value of acceleration due to gravity 'g' on Earth's surface is approximately:",
      options: { A: '6.67 N/kg', B: '8.9 m/s\u00b2', C: '9.8 m/s\u00b2', D: '10.8 m/s\u00b2' },
      correctKey: 'C',
      explanation: "Standard gravitational acceleration at Earth's surface is approximately 9.8 m/s\u00b2.",
      difficulty: 'easy',
    },
    {
      chapter: 'Atoms',
      text: "In Bohr's model of the hydrogen atom, an electron emits energy when it:",
      options: { A: 'Jumps to a higher energy orbit', B: 'Jumps to a lower energy orbit', C: 'Stays in the same orbit', D: 'Leaves the atom entirely' },
      correctKey: 'B',
      explanation: 'An electron emits a photon of energy when it transitions from a higher to a lower energy orbit.',
      difficulty: 'medium',
    },
    {
      chapter: 'Semiconductor Electronics',
      text: 'A p-n junction diode primarily allows current to flow:',
      options: { A: 'Equally in both directions', B: 'Only in one direction (when forward biased)', C: 'Only when reverse biased', D: 'Never' },
      correctKey: 'B',
      explanation: 'A p-n junction diode conducts significantly only in forward bias, acting as a one-way valve for current.',
      difficulty: 'medium',
    },
    {
      chapter: 'Wave Optics',
      text: "Young's double-slit experiment demonstrates which property of light?",
      options: { A: 'Reflection', B: 'Dispersion', C: 'Interference', D: 'Polarization only' },
      correctKey: 'C',
      explanation: "Young's double-slit experiment produces an interference pattern of bright and dark fringes, confirming light's wave nature.",
      difficulty: 'medium',
    },
    {
      chapter: 'Oscillations',
      text: 'For a simple harmonic oscillator, the restoring force is:',
      options: { A: 'Constant', B: 'Proportional to displacement and directed opposite to it', C: 'Proportional to velocity', D: 'Zero at maximum displacement' },
      correctKey: 'B',
      explanation: 'In SHM, restoring force F = -kx, proportional to displacement and always directed toward the equilibrium position.',
      difficulty: 'medium',
    },
  ],
  Chemistry: [
    {
      chapter: 'Some Basic Concepts of Chemistry',
      text: "Avogadro's number represents the number of particles in:",
      options: { A: 'One gram of a substance', B: 'One mole of a substance', C: 'One litre of a gas', D: 'One atomic mass unit' },
      correctKey: 'B',
      explanation: "Avogadro's number (\u2248 6.022 \u00d7 10\u00b2\u00b3) is the number of constituent particles in exactly one mole of a substance.",
      difficulty: 'easy',
    },
    {
      chapter: 'Structure of Atom',
      text: 'The maximum number of electrons in a shell with principal quantum number n is given by:',
      options: { A: 'n', B: '2n', C: 'n\u00b2', D: '2n\u00b2' },
      correctKey: 'D',
      explanation: 'The maximum electron capacity of a shell is 2n\u00b2, derived from the allowed subshells and their electron capacities.',
      difficulty: 'medium',
    },
    {
      chapter: 'Chemical Bonding and Molecular Structure',
      text: 'A bond formed by the complete transfer of electrons from one atom to another is called:',
      options: { A: 'Covalent bond', B: 'Ionic bond', C: 'Metallic bond', D: 'Hydrogen bond' },
      correctKey: 'B',
      explanation: 'An ionic bond forms via complete electron transfer, producing oppositely charged ions held together by electrostatic attraction.',
      difficulty: 'easy',
    },
    {
      chapter: 'Equilibrium',
      text: "Le Chatelier's principle predicts that a system at equilibrium, when disturbed, will:",
      options: { A: 'Collapse entirely', B: 'Shift to counteract the disturbance', C: 'Remain completely unchanged', D: 'Shift randomly' },
      correctKey: 'B',
      explanation: 'Le Chatelier\u2019s principle: a system at equilibrium shifts in the direction that partially counteracts an applied change.',
      difficulty: 'medium',
    },
    {
      chapter: 'Redox Reactions',
      text: 'In a redox reaction, oxidation refers to:',
      options: { A: 'Gain of electrons', B: 'Loss of electrons', C: 'Gain of protons', D: 'No change in electron count' },
      correctKey: 'B',
      explanation: 'Oxidation is defined as the loss of electrons (and the corresponding increase in oxidation state).',
      difficulty: 'easy',
    },
    {
      chapter: 'Electrochemistry',
      text: 'The standard hydrogen electrode (SHE) is assigned a reduction potential of:',
      options: { A: '+1.00 V', B: '-1.00 V', C: '0.00 V', D: '2.00 V' },
      correctKey: 'C',
      explanation: 'By convention, the standard hydrogen electrode is assigned a standard reduction potential of exactly 0.00 V.',
      difficulty: 'medium',
    },
    {
      chapter: 'Coordination Compounds',
      text: 'The coordination number of a central metal atom refers to:',
      options: { A: 'Its oxidation state', B: 'The number of donor atoms bonded to it', C: 'Its atomic number', D: 'The charge on the complex' },
      correctKey: 'B',
      explanation: 'Coordination number is the number of ligand donor atoms directly bonded to the central metal atom or ion.',
      difficulty: 'medium',
    },
    {
      chapter: 'Biomolecules',
      text: 'Which of the following is a monosaccharide?',
      options: { A: 'Sucrose', B: 'Starch', C: 'Glucose', D: 'Cellulose' },
      correctKey: 'C',
      explanation: 'Glucose is a simple sugar (monosaccharide); sucrose is a disaccharide, while starch and cellulose are polysaccharides.',
      difficulty: 'easy',
    },
    {
      chapter: 'Classification of Elements and Periodicity in Properties',
      text: 'As you move left to right across a period, atomic radius generally:',
      options: { A: 'Increases', B: 'Decreases', C: 'Stays the same', D: 'Increases then decreases randomly' },
      correctKey: 'B',
      explanation: 'Atomic radius generally decreases across a period due to increasing nuclear charge pulling electrons closer.',
      difficulty: 'medium',
    },
    {
      chapter: 'Hydrocarbons',
      text: 'Alkanes are characterized by which type of carbon-carbon bonding?',
      options: { A: 'Only double bonds', B: 'Only triple bonds', C: 'Only single bonds', D: 'A mix of double and triple bonds' },
      correctKey: 'C',
      explanation: 'Alkanes are saturated hydrocarbons containing only single (sigma) carbon-carbon bonds.',
      difficulty: 'easy',
    },
  ],
  Biology: [
    {
      chapter: 'Cell — The Unit of Life',
      text: 'Which cell organelle is known as the "powerhouse of the cell"?',
      options: { A: 'Nucleus', B: 'Ribosome', C: 'Mitochondria', D: 'Golgi apparatus' },
      correctKey: 'C',
      explanation: 'Mitochondria generate most of the cell\u2019s ATP through cellular respiration, earning the nickname "powerhouse of the cell."',
      difficulty: 'easy',
    },
    {
      chapter: 'Molecular Basis of Inheritance',
      text: 'The DNA double helix structure was proposed by:',
      options: { A: 'Gregor Mendel', B: 'Watson and Crick', C: 'Charles Darwin', D: 'Louis Pasteur' },
      correctKey: 'B',
      explanation: 'James Watson and Francis Crick proposed the double-helix model of DNA structure in 1953.',
      difficulty: 'easy',
    },
    {
      chapter: 'Principles of Inheritance and Variation',
      text: "Mendel's Law of Segregation states that:",
      options: { A: 'Alleles assort independently of each other', B: 'The two alleles of a gene separate during gamete formation', C: 'Traits always blend in offspring', D: 'Dominant traits disappear in F2 generation' },
      correctKey: 'B',
      explanation: 'The Law of Segregation states that the two alleles for a trait separate during gamete formation, each gamete getting only one.',
      difficulty: 'medium',
    },
    {
      chapter: 'Photosynthesis in Higher Plants',
      text: 'The light-dependent reactions of photosynthesis occur in the:',
      options: { A: 'Stroma', B: 'Thylakoid membrane', C: 'Mitochondrial matrix', D: 'Cell wall' },
      correctKey: 'B',
      explanation: 'Light-dependent reactions occur in the thylakoid membrane, where chlorophyll captures light energy.',
      difficulty: 'medium',
    },
    {
      chapter: 'Biological Classification',
      text: 'The five-kingdom classification system was proposed by:',
      options: { A: 'Carl Linnaeus', B: 'R.H. Whittaker', C: 'Charles Darwin', D: 'Ernst Haeckel' },
      correctKey: 'B',
      explanation: 'R.H. Whittaker proposed the five-kingdom classification (Monera, Protista, Fungi, Plantae, Animalia) in 1969.',
      difficulty: 'medium',
    },
    {
      chapter: 'Human Health and Disease',
      text: 'Malaria in humans is caused by a:',
      options: { A: 'Bacterium', B: 'Virus', C: 'Protozoan parasite (Plasmodium)', D: 'Fungus' },
      correctKey: 'C',
      explanation: 'Malaria is caused by protozoan parasites of the genus Plasmodium, transmitted via female Anopheles mosquitoes.',
      difficulty: 'easy',
    },
    {
      chapter: 'Biotechnology — Principles and Processes',
      text: 'Restriction enzymes function by:',
      options: { A: 'Joining DNA fragments together', B: 'Cutting DNA at specific recognition sequences', C: 'Replicating DNA', D: 'Translating mRNA into protein' },
      correctKey: 'B',
      explanation: 'Restriction enzymes (restriction endonucleases) cut DNA at specific palindromic recognition sequences.',
      difficulty: 'medium',
    },
    {
      chapter: 'Ecosystem',
      text: 'In a food chain, organisms that produce their own food are called:',
      options: { A: 'Primary consumers', B: 'Decomposers', C: 'Producers', D: 'Secondary consumers' },
      correctKey: 'C',
      explanation: 'Producers (mainly green plants and algae) synthesize their own food via photosynthesis, forming the base of a food chain.',
      difficulty: 'easy',
    },
    {
      chapter: 'Evolution',
      text: "Darwin's theory of evolution is primarily based on the principle of:",
      options: { A: 'Use and disuse of organs', B: 'Natural selection', C: 'Inheritance of acquired characteristics', D: 'Punctuated equilibrium' },
      correctKey: 'B',
      explanation: "Darwin's theory centers on natural selection: organisms with favorable variations survive and reproduce more successfully.",
      difficulty: 'medium',
    },
    {
      chapter: 'Human Reproduction',
      text: 'Fertilization in humans normally occurs in the:',
      options: { A: 'Uterus', B: 'Ovary', C: 'Fallopian tube (oviduct)', D: 'Cervix' },
      correctKey: 'C',
      explanation: 'Fertilization normally occurs in the ampullary region of the fallopian tube (oviduct).',
      difficulty: 'medium',
    },
  ],
};

// ── Flashcards: quick front/back recall cards ──
const FLASHCARDS = {
  Physics: [
    { front: 'SI unit of force', back: 'Newton (N) — 1 N = 1 kg\u00b7m/s\u00b2' },
    { front: 'SI unit of energy', back: 'Joule (J)' },
    { front: "Newton's First Law", back: 'A body remains at rest or in uniform motion unless acted on by a net external force (Law of Inertia).' },
    { front: 'Formula: Kinetic Energy', back: 'KE = \u00bd mv\u00b2' },
    { front: 'Formula: Ohm\u2019s Law', back: 'V = IR (Voltage = Current \u00d7 Resistance)' },
    { front: 'Speed of light in vacuum', back: 'c \u2248 3 \u00d7 10\u2078 m/s' },
    { front: 'Unit of frequency', back: 'Hertz (Hz) — cycles per second' },
    { front: 'Escape velocity (Earth)', back: '\u2248 11.2 km/s — minimum speed to escape Earth\u2019s gravity without further propulsion' },
    { front: 'Doppler Effect', back: 'The apparent change in frequency of a wave due to relative motion between source and observer' },
    { front: "Lenz's Law", back: 'The induced current opposes the change in magnetic flux that produced it (conservation of energy applied to EM induction)' },
  ],
  Chemistry: [
    { front: "Avogadro's Number", back: '6.022 \u00d7 10\u00b2\u00b3 particles per mole' },
    { front: 'pH of a neutral solution', back: '7 (at 25\u00b0C)' },
    { front: 'Definition: Isotopes', back: 'Atoms of the same element with the same number of protons but different numbers of neutrons' },
    { front: 'Octet Rule', back: 'Atoms tend to gain, lose, or share electrons to have 8 electrons in their outermost shell' },
    { front: 'Exothermic vs Endothermic', back: 'Exothermic releases heat (\u0394H negative); endothermic absorbs heat (\u0394H positive)' },
    { front: 'Functional group: -COOH', back: 'Carboxylic acid group' },
    { front: 'Functional group: -OH', back: 'Hydroxyl group (alcohols)' },
    { front: "Le Chatelier's Principle", back: 'A system at equilibrium shifts to counteract any imposed change in concentration, pressure, or temperature' },
    { front: 'Strong acid example', back: 'HCl (hydrochloric acid) — fully dissociates in water' },
    { front: 'Catalyst', back: 'A substance that speeds up a reaction without being consumed, by lowering activation energy' },
  ],
  Biology: [
    { front: 'Powerhouse of the cell', back: 'Mitochondria — site of ATP production via cellular respiration' },
    { front: 'DNA structure discoverers', back: 'James Watson and Francis Crick (1953) — double helix model' },
    { front: 'Site of photosynthesis (light reactions)', back: 'Thylakoid membrane of the chloroplast' },
    { front: 'Site of photosynthesis (dark reactions)', back: 'Stroma of the chloroplast (Calvin cycle)' },
    { front: 'Mendel\u2019s Law of Segregation', back: 'The two alleles for a trait separate during gamete formation' },
    { front: 'Malaria causative agent', back: 'Plasmodium (a protozoan parasite), transmitted by female Anopheles mosquito' },
    { front: 'Human diploid chromosome number', back: '46 (23 pairs)' },
    { front: 'Definition: Homeostasis', back: 'The maintenance of a stable internal environment despite external changes' },
    { front: 'Producers in an ecosystem', back: 'Organisms (mainly green plants/algae) that synthesize their own food via photosynthesis' },
    { front: 'Natural Selection (Darwin)', back: 'Organisms with favorable heritable traits survive and reproduce more successfully than others' },
  ],
};

async function seed() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ MONGO_URI not set. Run with: MONGO_URI="..." node scripts/seedQuestionsAndFlashcards.js');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  let qCount = 0;
  let fCount = 0;

  for (const [subjectName, questions] of Object.entries(QUESTIONS)) {
    const subject = await Subject.findOne({ examGroup: EXAM_GROUP, name: subjectName });
    if (!subject) {
      console.warn(`⚠️  Subject not found: ${subjectName} (${EXAM_GROUP}) — run seedCurriculum.js first. Skipping.`);
      continue;
    }

    for (const q of questions) {
      let chapterDoc = null;
      if (q.chapter) {
        chapterDoc = await Chapter.findOne({ subject: subject._id, title: q.chapter });
      }

      const options = Object.entries(q.options).map(([key, text]) => ({ key, text }));

      await Question.findOneAndUpdate(
        { subject: subject._id, text: q.text },
        {
          subject: subject._id,
          chapter: chapterDoc ? chapterDoc._id : undefined,
          examGroup: EXAM_GROUP,
          text: q.text,
          options,
          correctKey: q.correctKey,
          explanation: q.explanation,
          difficulty: q.difficulty,
        },
        { upsert: true, new: true }
      );
      qCount++;
    }
  }

  for (const [subjectName, cards] of Object.entries(FLASHCARDS)) {
    const subject = await Subject.findOne({ examGroup: EXAM_GROUP, name: subjectName });
    if (!subject) continue;

    for (const c of cards) {
      await Flashcard.findOneAndUpdate(
        { subject: subject._id, front: c.front },
        { subject: subject._id, examGroup: EXAM_GROUP, front: c.front, back: c.back },
        { upsert: true, new: true }
      );
      fCount++;
    }
  }

  console.log(`✅ Seeded/updated ${qCount} questions and ${fCount} flashcards for ${EXAM_GROUP}.`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
