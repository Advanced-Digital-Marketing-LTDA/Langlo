// Holdout prompts reworded because the task was unclear, by the earlier
// question's id. The revision carries exactly this prompt and changes nothing
// else about the question; the new wording is pinned here word for word.
export const clarifiedPrompts = new Map<string, string>([
  ['de-a1-011@1:h01', 'Which sentence mentions a house for the first time?'],
  ['en-a1-008@2:h02', 'Write the negative sentence: we / be / at school'],
  ['en-a1-010@1:h02', 'Write the sentence (add a/an): I / see / egg'],
  ['en-a1-012@1:h01', 'Which positive sentence uses some/any correctly?'],
  [
    'en-a1-014@2:h03',
    'Write the comparative sentence: this film / be / interesting / than / that film'
  ],
  ['en-a1-017@2:h03', 'Write a negative instruction: run / in the school'],
  ['en-a1-018@1:h01', "Which sentence joins two sports with 'and'?"],
  [
    'en-a1-021@1:h02',
    'Write the question with there is/are: any apples / in the bag'
  ],
  ['en-a1-024@1:h02', 'Write the question (use be): he / at work'],
  ['en-a2-001@2:h02', 'Write the past simple question: they / visit / London'],
  ['en-a2-005@2:h03', 'Write the question with will: you / open / the window'],
  [
    'en-a2-007@1:h03',
    'Write the negative sentence with could: we / hear / the music'
  ],
  ['en-a2-009@1:h03', 'Write negative advice with should: we / stay / up late'],
  ['en-a2-010@2:h01', "Which sentence uses 'would like' correctly?"],
  [
    'en-a2-013@1:h01',
    'Which sentence uses the right relative word for a thing?'
  ],
  ['en-a2-014@1:h02', 'Brush your teeth ___ you go to bed. (earlier than)'],
  ['en-a2-018@1:h01', "Which sentence uses the right quantifier for 'money'?"],
  [
    'en-a2-019@1:h03',
    'Write a statement with a question tag: they / live / here'
  ],
  ['en-a2-020@1:h01', "Which sentence puts 'never' in the right place?"],
  ['en-a2-023@2:h01', "Which sentence uses 'stop' with the right verb form?"],
  ['fr-a1-001@1:h01', 'La boulangerie ___ tôt. (fermer)'],
  ['fr-a1-023@2:h01', "Which reflexive pronoun goes with 'vous'?"],
  ['fr-a1-027@1:h02', 'Elle est ___. (acteur, feminine)'],
  ['pt-b1-027@2:h01', "Choose the sentence: 'He has two small children'."],
  [
    'pt-b2-026@1:h02',
    '___ a lição. (explicar + lhe, ele, pretérito perfeito, início da frase) (colocação do pronome)'
  ],
  [
    'pt-b2-028@1:h02',
    "Write 'to read it' (ler + o): ___ (pronomes combinados)"
  ],
  [
    'pt-b2-040@1:h02',
    'Eles ___ . (crer, presente, 1990 spelling) (ortografia atual)'
  ]
]);
