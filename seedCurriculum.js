// Seeds Subject + Chapter collections with real curriculum structure
// per exam group. Safe to re-run — upserts, never duplicates.
// Also removes any old chapters no longer present in CURRICULUM below,
// so re-running with an expanded list doesn't leave stale duplicates.
//
// Usage:
//   MONGO_URI="your_connection_string" node scripts/seedCurriculum.js

require('dotenv').config();
const mongoose = require('mongoose');
const Subject  = require('../models/Subject');
const Chapter  = require('../models/Chapter');

const COLORS = ['#2563EB', '#0FA89A', '#7C3AED', '#DB2777', '#EA580C', '#65A30D'];

// ── Curriculum data ────────────────────────────────────────────
// Full syllabus-depth chapter lists per subject.
const CURRICULUM = {
  NEET_UG: {
    Physics: ['Physical World', 'Units and Measurements', 'Motion in a Straight Line', 'Motion in a Plane', 'Laws of Motion', 'Work, Energy and Power', 'System of Particles and Rotational Motion', 'Gravitation', 'Mechanical Properties of Solids', 'Mechanical Properties of Fluids', 'Thermal Properties of Matter', 'Thermodynamics', 'Kinetic Theory', 'Oscillations', 'Waves', 'Electric Charges and Fields', 'Electrostatic Potential and Capacitance', 'Current Electricity', 'Moving Charges and Magnetism', 'Magnetism and Matter', 'Electromagnetic Induction', 'Alternating Current', 'Electromagnetic Waves', 'Ray Optics and Optical Instruments', 'Wave Optics', 'Dual Nature of Radiation and Matter', 'Atoms', 'Nuclei', 'Semiconductor Electronics'],
    Chemistry: ['Some Basic Concepts of Chemistry', 'Structure of Atom', 'Classification of Elements and Periodicity in Properties', 'Chemical Bonding and Molecular Structure', 'States of Matter', 'Thermodynamics', 'Equilibrium', 'Redox Reactions', 'Hydrogen', 's-Block Elements', 'p-Block Elements (Group 13 & 14)', 'Organic Chemistry — Basic Principles and Techniques', 'Hydrocarbons', 'Environmental Chemistry', 'Solid State', 'Solutions', 'Electrochemistry', 'Chemical Kinetics', 'Surface Chemistry', 'General Principles of Isolation of Elements', 'p-Block Elements (Group 15–18)', 'd and f Block Elements', 'Coordination Compounds', 'Haloalkanes and Haloarenes', 'Alcohols, Phenols and Ethers', 'Aldehydes, Ketones and Carboxylic Acids', 'Amines', 'Biomolecules', 'Polymers', 'Chemistry in Everyday Life'],
    Biology: ['The Living World', 'Biological Classification', 'Plant Kingdom', 'Animal Kingdom', 'Morphology of Flowering Plants', 'Anatomy of Flowering Plants', 'Structural Organisation in Animals', 'Cell — The Unit of Life', 'Biomolecules', 'Cell Cycle and Cell Division', 'Transport in Plants', 'Mineral Nutrition', 'Photosynthesis in Higher Plants', 'Respiration in Plants', 'Plant Growth and Development', 'Digestion and Absorption', 'Breathing and Exchange of Gases', 'Body Fluids and Circulation', 'Excretory Products and their Elimination', 'Locomotion and Movement', 'Neural Control and Coordination', 'Chemical Coordination and Integration', 'Sexual Reproduction in Flowering Plants', 'Human Reproduction', 'Reproductive Health', 'Principles of Inheritance and Variation', 'Molecular Basis of Inheritance', 'Evolution', 'Human Health and Disease', 'Strategies for Enhancement in Food Production', 'Microbes in Human Welfare', 'Biotechnology — Principles and Processes', 'Biotechnology and its Applications', 'Organisms and Populations', 'Ecosystem', 'Biodiversity and Conservation', 'Environmental Issues'],
  },
  PG_CLINICAL: {
    'Anatomy': ['Upper Limb', 'Lower Limb', 'Thorax', 'Abdomen', 'Pelvis and Perineum', 'Head and Neck', 'Neuroanatomy (Brain & Spinal Cord)', 'Embryology — General', 'Embryology — Systemic', 'Histology — General', 'Genetics Basics', 'Cross-sectional and Radiological Anatomy'],
    'Physiology': ['General Physiology and Cell', 'Blood and Immunity', 'Nerve-Muscle Physiology', 'Cardiovascular System', 'Respiratory System', 'Renal Physiology', 'Gastrointestinal System', 'Endocrinology', 'Reproductive Physiology', 'Central Nervous System', 'Special Senses'],
    'Biochemistry': ['Biomolecules and Enzymes', 'Carbohydrate Metabolism', 'Lipid Metabolism', 'Protein and Amino Acid Metabolism', 'Nucleic Acid Metabolism', 'Molecular Biology and Genetics', 'Vitamins and Minerals', 'Hormones — Biochemical Aspects', 'Acid-Base and Electrolyte Balance', 'Clinical and Nutritional Biochemistry'],
    'Pathology': ['General Pathology — Cell Injury and Inflammation', 'Neoplasia', 'Hematology and Blood Disorders', 'Cardiovascular Pathology', 'Respiratory Pathology', 'GI and Hepatobiliary Pathology', 'Renal and Urinary Pathology', 'Endocrine Pathology', 'Reproductive System Pathology', 'CNS Pathology', 'Musculoskeletal Pathology', 'Clinical Pathology and Hematology Lab'],
    'Pharmacology': ['General Pharmacology — Pharmacokinetics & Pharmacodynamics', 'Autonomic Nervous System Drugs', 'Cardiovascular Drugs', 'CNS Drugs (Anxiolytics, Antipsychotics, Antiepileptics)', 'Antimicrobials', 'Antineoplastic Drugs', 'Endocrine Pharmacology', 'GI and Renal Drugs', 'Respiratory System Drugs', 'Analgesics, NSAIDs and Anesthetic Agents', 'Toxicology and Drug Interactions'],
    'Microbiology': ['General Bacteriology', 'Systemic Bacteriology', 'Virology', 'Mycology', 'Parasitology — Protozoa', 'Parasitology — Helminths', 'Immunology', 'Applied/Hospital Microbiology and Infection Control'],
    'Forensic Medicine & Toxicology': ['Forensic Medicine — Legal Procedures', 'Identification and Age Estimation', 'Death and its Medicolegal Aspects', 'Asphyxial Deaths', 'Mechanical and Thermal Injuries', 'Forensic Psychiatry', 'General Toxicology', 'Specific Poisons (Corrosives, Metallic, Organic)'],
    'Community Medicine (PSM)': ['Epidemiology — Concepts and Methods', 'Biostatistics', 'Demography and Family Planning', 'Maternal and Child Health', 'Nutrition and Public Health', 'Communicable Disease Control', 'Non-Communicable Diseases', 'Environmental and Occupational Health', 'National Health Programs', 'Health Administration and Planning'],
    'General Medicine': ['Cardiology', 'Pulmonology', 'Gastroenterology and Hepatology', 'Nephrology', 'Endocrinology and Metabolism', 'Neurology', 'Rheumatology and Immunology', 'Infectious Diseases', 'Hematology and Oncology', 'Critical Care and Emergency Medicine', 'Dermatology Basics in Medicine'],
    'General Surgery': ['General Surgery Principles', 'GI Surgery', 'Hepatobiliary and Pancreatic Surgery', 'Breast and Endocrine Surgery', 'Urology', 'Vascular Surgery', 'Neurosurgery Basics', 'Cardiothoracic Surgery Basics', 'Trauma and Burns', 'Pediatric Surgery', 'Surgical Oncology'],
    'Obstetrics & Gynaecology': ['Normal Pregnancy and Antenatal Care', 'Labour and Delivery', 'High-Risk Pregnancy', 'Postpartum Care and Complications', 'Gynecological Anatomy and Physiology', 'Menstrual Disorders', 'Infertility', 'Gynecological Oncology', 'Contraception', 'Pelvic Infections and Inflammatory Disease'],
    'Paediatrics': ['Growth and Development', 'Neonatology', 'Nutrition and Malnutrition', 'Immunization', 'Infectious Diseases in Children', 'Pediatric Cardiology and Respiratory Disorders', 'Pediatric Neurology', 'Genetic and Metabolic Disorders', 'Pediatric Emergencies'],
    'ENT': ['Ear — Anatomy and Hearing Disorders', 'Nose and Paranasal Sinuses', 'Throat and Larynx', 'Head and Neck Tumors', 'ENT Emergencies'],
    'Ophthalmology': ['Anatomy and Physiology of the Eye', 'Refractive Errors', 'Cataract and Lens Disorders', 'Glaucoma', 'Retina and Vitreous Disorders', 'Cornea and External Eye Disease', 'Ocular Emergencies'],
    'Orthopaedics': ['Fractures — General Principles', 'Upper Limb Fractures and Injuries', 'Lower Limb Fractures and Injuries', 'Spine Disorders', 'Bone Tumors and Infections', 'Pediatric Orthopedics', 'Orthopedic Trauma and Emergencies'],
    'Dermatology': ['Skin Structure and Basic Lesions', 'Infections and Infestations', 'Eczema and Papulosquamous Disorders', 'Bullous Disorders', 'Pigmentary Disorders', 'Skin Tumors', 'Sexually Transmitted Infections'],
    'Psychiatry': ['Psychiatric History and Examination', 'Mood Disorders', 'Anxiety and Somatoform Disorders', 'Psychotic Disorders', 'Substance Use Disorders', 'Child and Adolescent Psychiatry', 'Psychopharmacology Basics'],
    'Anaesthesia': ['General Anesthesia Principles', 'Regional and Local Anesthesia', 'Airway Management', 'Pain Management', 'Critical Care Basics', 'Anesthetic Emergencies'],
    'Radiology': ['X-Ray Interpretation Basics', 'Chest Imaging', 'Abdominal Imaging', 'Musculoskeletal Imaging', 'CNS Imaging (CT/MRI Basics)', 'Ultrasound Fundamentals', 'Contrast Studies and Safety'],
  },
  USMLE_STEP1: {
    'Anatomy & Embryology': ['Upper and Lower Limb Anatomy', 'Thoracic and Abdominal Anatomy', 'Head and Neck Anatomy', 'Neuroanatomy', 'General Embryology', 'Systemic Embryology and Congenital Anomalies'],
    'Physiology': ['Cardiovascular Physiology', 'Respiratory Physiology', 'Renal Physiology and Acid-Base', 'Endocrine Physiology', 'Gastrointestinal Physiology', 'Reproductive Physiology', 'Neurophysiology'],
    'Biochemistry & Genetics': ['Molecular Biology Basics', 'Carbohydrate and Lipid Metabolism', 'Amino Acid and Nucleotide Metabolism', 'Genetics and Inheritance Patterns', 'Vitamins and Cofactors'],
    'Pathology': ['General Principles of Pathology', 'Cardiovascular Pathology', 'Pulmonary Pathology', 'GI and Hepatobiliary Pathology', 'Renal Pathology', 'Endocrine Pathology', 'Hematology/Oncology', 'Neuropathology', 'Reproductive Pathology'],
    'Pharmacology': ['Pharmacokinetics and Pharmacodynamics', 'Autonomic Drugs', 'Cardiovascular Pharmacology', 'CNS Pharmacology', 'Antimicrobials', 'Endocrine Pharmacology', 'Toxicology', 'Chemotherapeutic Agents'],
    'Microbiology & Immunology': ['Bacteriology', 'Virology', 'Mycology and Parasitology', 'Immunology — Innate and Adaptive', 'Immunodeficiencies and Hypersensitivity'],
    'Behavioral Science': ['Biostatistics and Epidemiology', 'Ethics and Patient Safety', 'Psychology and Development', 'Substance Use'],
  },
  USMLE_STEP2: {
    'Internal Medicine': ['Cardiology', 'Pulmonology', 'Gastroenterology', 'Nephrology', 'Endocrinology', 'Infectious Disease', 'Hematology/Oncology', 'Rheumatology', 'Critical Care'],
    'Surgery': ['Preoperative and Postoperative Care', 'GI Surgery', 'Trauma Surgery', 'Vascular Surgery', 'Urologic Surgery', 'Surgical Oncology'],
    'Obstetrics & Gynaecology': ['Antepartum Care', 'Intrapartum and Postpartum Management', 'Gynecologic Disorders', 'Reproductive Endocrinology', 'Gynecologic Oncology'],
    'Paediatrics': ['Neonatal Care', 'Growth and Developmental Milestones', 'Common Pediatric Illnesses', 'Pediatric Emergencies', 'Immunizations and Preventive Care'],
    'Psychiatry': ['Mood and Anxiety Disorders', 'Psychotic Disorders', 'Substance Use Disorders', 'Pediatric and Adolescent Psychiatry'],
    'Family Medicine': ['Health Maintenance and Screening', 'Chronic Disease Management', 'Preventive Counseling'],
  },
  USMLE_STEP3: {
    'Patient Management': ['Ambulatory Patient Care', 'Inpatient Management', 'Emergency Department Management', 'Chronic Disease Long-Term Management'],
    'Ambulatory Medicine': ['Preventive Care and Screening', 'Common Outpatient Presentations', 'Health Maintenance Across the Lifespan'],
    'Clinical Therapeutics': ['Evidence-Based Treatment Selection', 'Drug Monitoring and Adjustment', 'Multi-System Disease Management'],
    'Preventive Medicine': ['Screening Guidelines', 'Public Health Basics', 'Health Promotion Strategies'],
  },
};

async function seed() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ MONGO_URI not set. Run with: MONGO_URI="..." node scripts/seedCurriculum.js');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  let subjectCount = 0;
  let chapterCount = 0;
  let removedCount = 0;

  for (const [examGroup, subjects] of Object.entries(CURRICULUM)) {
    let subjOrder = 0;
    for (const [subjectName, chapterTitles] of Object.entries(subjects)) {
      const color = COLORS[subjOrder % COLORS.length];

      const subject = await Subject.findOneAndUpdate(
        { examGroup, name: subjectName },
        { $set: { order: subjOrder, color } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      subjectCount++;
      subjOrder++;

      let chOrder = 0;
      for (const title of chapterTitles) {
        await Chapter.findOneAndUpdate(
          { subject: subject._id, title },
          { $set: { order: chOrder, totalUnits: 4, estimatedMinutes: 45 } },
          { upsert: true, setDefaultsOnInsert: true }
        );
        chapterCount++;
        chOrder++;
      }

      const result = await Chapter.deleteMany({
        subject: subject._id,
        title: { $nin: chapterTitles },
      });
      removedCount += result.deletedCount || 0;
    }
    console.log(`  ${examGroup}: ${Object.keys(subjects).length} subjects seeded`);
  }

  console.log(`\n✅ Done. ${subjectCount} subject upserts, ${chapterCount} chapter upserts, ${removedCount} stale chapters removed.`);
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
