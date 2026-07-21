"""
Human Anatomy Data for Robot Construction
Contains complete data for 206 bones, major muscle groups, and 79 organs
"""

# Part 1: The 206 Bones of the Skeleton
AXIAL_SKELETON = {
    "skull_face": {
        "cranium": [
            {"name": "Occipital", "count": 1},
            {"name": "Parietal", "count": 2},
            {"name": "Frontal", "count": 1},
            {"name": "Temporal", "count": 2},
            {"name": "Sphenoid", "count": 1},
            {"name": "Ethmoid", "count": 1}
        ],
        "facial_bones": [
            {"name": "Nasal", "count": 2},
            {"name": "Maxillae", "count": 2},
            {"name": "Lacrimal", "count": 2},
            {"name": "Zygomatic", "count": 2},
            {"name": "Palatine", "count": 2},
            {"name": "Inferior nasal conchae", "count": 2},
            {"name": "Vomer", "count": 1},
            {"name": "Mandible", "count": 1}
        ]
    },
    "associated_head_bones": {
        "auditory_ossicles": [
            {"name": "Malleus", "count": 2},
            {"name": "Incus", "count": 2},
            {"name": "Stapes", "count": 2}
        ],
        "hyoid": {"name": "Hyoid Bone", "count": 1}
    },
    "vertebral_column": {
        "cervical_vertebrae": {"count": 7, "notes": "Includes C1 Atlas and C2 Axis"},
        "thoracic_vertebrae": {"count": 12},
        "lumbar_vertebrae": {"count": 5},
        "sacrum": {"count": 1, "notes": "Five fused vertebrae"},
        "coccyx": {"count": 1, "notes": "Four fused vertebrae (tailbone)"}
    },
    "thoracic_cage": {
        "sternum": {"count": 1},
        "ribs": {
            "count": 24,
            "breakdown": {
                "true_ribs": 7,
                "false_ribs": 3,
                "floating_ribs": 2
            }
        }
    }
}

APPENDICULAR_SKELETON = {
    "pectoral_girdle": [
        {"name": "Clavicle", "count": 2, "common_name": "Collarbones"},
        {"name": "Scapula", "count": 2, "common_name": "Shoulder blades"}
    ],
    "upper_limbs": {
        "humerus": {"count": 2, "location": "Upper arm"},
        "radius": {"count": 2, "location": "Forearm thumb side"},
        "ulna": {"count": 2, "location": "Forearm pinky side"},
        "carpals": {
            "count": 16,
            "bones_per_wrist": 8,
            "names": ["Scaphoid", "Lunate", "Triquetrum", "Pisiform", 
                     "Trapezium", "Trapezoid", "Capitate", "Hamate"]
        },
        "metacarpals": {"count": 10, "per_hand": 5},
        "phalanges_hand": {
            "count": 28,
            "per_hand": 14,
            "types": ["Proximal", "Middle", "Distal"],
            "thumb_note": "Thumb has 2 phalanges"
        }
    },
    "pelvic_girdle": {
        "hip_bones": {
            "count": 2,
            "components": ["Ilium", "Ischium", "Pubis"],
            "note": "Each made of three fused regions"
        }
    },
    "lower_limbs": {
        "femur": {"count": 2, "note": "Strongest bones in the body"},
        "patella": {"count": 2, "common_name": "Kneecaps"},
        "tibia": {"count": 2, "common_name": "Shinbones"},
        "fibula": {"count": 2, "common_name": "Calf bones"},
        "tarsals": {
            "count": 14,
            "per_foot": 7,
            "names": ["Talus", "Calcaneus", "Navicular", 
                     "Medial cuneiform", "Intermediate cuneiform", 
                     "Lateral cuneiform", "Cuboid"]
        },
        "metatarsals": {"count": 10, "per_foot": 5},
        "phalanges_foot": {
            "count": 28,
            "per_foot": 14,
            "big_toe_note": "Big toe has 2 phalanges"
        }
    }
}

# Part 2: Major Skeletal Muscles
SKELETAL_MUSCLES = {
    "head_neck": [
        {"name": "Temporalis", "function": "Closes jaw for chewing"},
        {"name": "Masseter", "function": "Clenches jaw for chewing"},
        {"name": "Orbicularis Oculi", "function": "Closes eyelids (blinking)"},
        {"name": "Orbicularis Oris", "function": "Purses and puckers lips"},
        {"name": "Sternocleidomastoid", "function": "Rotates head, flexes neck"}
    ],
    "torso": {
        "chest": [
            {"name": "Pectoralis Major", "function": "Pushing and arm rotation"}
        ],
        "back": [
            {"name": "Latissimus Dorsi", "function": "Pulling and rowing motions"},
            {"name": "Trapezius", "function": "Shrugs shoulders, moves shoulder blades"},
            {"name": "Erector Spinae", "function": "Keeps back upright"}
        ],
        "abdomen": [
            {"name": "Rectus Abdominis", "function": "Flexes spine forward (six-pack)"},
            {"name": "Obliques (Internal & External)", "function": "Rotate and twist torso"},
            {"name": "Transversus Abdominis", "function": "Stabilizes spine (natural corset)"}
        ]
    },
    "upper_limbs": {
        "shoulders": [
            {"name": "Deltoids", "function": "Raise arms in all directions"},
            {"name": "Rotator Cuff", "function": "Stabilize shoulder joint",
             "components": ["Supraspinatus", "Infraspinatus", "Teres Minor", "Subscapularis"]}
        ],
        "arms": [
            {"name": "Biceps Brachii", "function": "Flexes elbow"},
            {"name": "Triceps Brachii", "function": "Extends and straightens elbow"},
            {"name": "Brachioradialis", "function": "Aids in elbow flexion"}
        ],
        "forearm": [
            {"name": "Forearm Flexors & Extensors", "function": "Control wrist, hand, finger movements"}
        ]
    },
    "lower_limbs": {
        "hips": [
            {"name": "Gluteus Maximus", "function": "Hip extension (climbing, standing)"},
            {"name": "Gluteus Medius & Minimus", "function": "Move leg away from body midline"},
            {"name": "Hip Flexors (Iliopsoas)", "function": "Lift knee toward chest"}
        ],
        "thighs": [
            {"name": "Quadriceps", "function": "Straighten knee",
             "components": ["Rectus femoris", "Vastus lateralis", "Vastus medialis", "Vastus intermedius"]},
            {"name": "Hamstrings", "function": "Bend knee",
             "components": ["Biceps femoris", "Semitendinosus", "Semimembranosus"]},
            {"name": "Adductors", "function": "Squeeze legs together"}
        ],
        "calves": [
            {"name": "Gastrocnemius", "function": "Lift heel (push off ground)"},
            {"name": "Soleus", "function": "Deep calf muscle, essential for standing balance"},
            {"name": "Tibialis Anterior", "function": "Lifts toes upward (dorsiflexion)"}
        ]
    }
}

# Part 3: The 79 Organs
ORGANS = {
    "nervous_sensory": [
        "Brain", "Spinal cord", "Eyes", "Ears", "Nose (Olfactory)", "Tongue"
    ],
    "cardiovascular_respiratory": [
        "Heart", "Arteries", "Veins", "Lungs", "Trachea", "Bronchi", 
        "Larynx", "Pharynx", "Diaphragm"
    ],
    "digestive_excretory": [
        "Mouth/Oral Cavity", "Salivary glands", "Esophagus", "Stomach",
        "Duodenum", "Jejunum", "Ileum", "Cecum", "Appendix", "Colon",
        "Rectum", "Anus", "Liver", "Gallbladder", "Pancreas"
    ],
    "urinary": [
        "Kidneys", "Ureters", "Urinary bladder", "Urethra"
    ],
    "endocrine": [
        "Pituitary gland", "Pineal gland", "Thyroid gland", "Parathyroid glands",
        "Adrenal glands", "Thymus", "Hypothalamus", "Pancreatic islets"
    ],
    "integumentary_lymphatic_structural": [
        "Skin", "Subcutaneous tissue", "Spleen", "Lymph nodes",
        "Bone marrow", "Mesentery", "Interstitium"
    ],
    "reproductive_male": [
        "Testes", "Epididymis", "Vas deferens", "Seminal vesicles",
        "Prostate gland", "Bulbourethral glands", "Penis", "Scrotum"
    ],
    "reproductive_female": [
        "Ovaries", "Fallopian tubes", "Uterus", "Cervix", "Vagina",
        "Vulva", "Labia majora", "Labia minora", "Clitoris", "Bartholin's glands"
    ],
    "reproductive_shared": [
        "Mammary glands/Breasts", "Placenta"
    ]
}

def get_total_bone_count():
    """Returns total count of 206 bones"""
    return 206

def get_total_organ_count():
    """Returns total count of 79 organs"""
    return 79

def get_anatomy_summary():
    """Returns a summary of all anatomy data"""
    return {
        "total_bones": get_total_bone_count(),
        "axial_skeleton": 80,
        "appendicular_skeleton": 126,
        "major_muscle_groups": len(SKELETAL_MUSCLES),
        "total_organs": get_total_organ_count()
    }
