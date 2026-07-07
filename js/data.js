/* Lumen — content banks: baseline test, verbal games, EQ scenarios, journal prompts, word lists. */
window.DATA = (function () {
  'use strict';

  /* ---------------- Baseline cognitive test (weights 1-3 by difficulty) ---------------- */
  const baselineIQ = [
    { q: 'What number comes next? 2, 4, 8, 16, …', options: ['24', '32', '30', '20'], answer: 1, w: 1, domain: 'logic' },
    { q: 'What number comes next? 64, 32, 16, 8, …', options: ['6', '2', '4', '0'], answer: 2, w: 1, domain: 'logic' },
    { q: 'What number comes next? 1, 1, 2, 3, 5, 8, …', options: ['13', '12', '11', '16'], answer: 0, w: 1, domain: 'logic' },
    { q: 'What number comes next? 3, 6, 11, 18, 27, …', options: ['36', '34', '38', '40'], answer: 2, w: 2, domain: 'logic' },
    { q: 'What number comes next? 2, 3, 5, 9, 17, …', options: ['33', '31', '29', '25'], answer: 0, w: 3, domain: 'logic' },
    { q: 'Book is to Reading as Fork is to…', options: ['Drawing', 'Writing', 'Stirring', 'Eating'], answer: 3, w: 1, domain: 'verbal' },
    { q: 'Ocean is to Pond as Continent is to…', options: ['Island', 'Country', 'Mountain', 'River'], answer: 0, w: 2, domain: 'verbal' },
    { q: 'Ephemeral is to Permanent as Turbulent is to…', options: ['Stormy', 'Calm', 'Rapid', 'Loud'], answer: 1, w: 3, domain: 'verbal' },
    { q: 'Which word does not belong? Chair, Table, Bed, Spoon', options: ['Chair', 'Table', 'Bed', 'Spoon'], answer: 3, w: 1, domain: 'verbal' },
    { q: 'Which word does not belong? Ephemeral, Fleeting, Transient, Eternal', options: ['Ephemeral', 'Fleeting', 'Transient', 'Eternal'], answer: 3, w: 3, domain: 'verbal' },
    { q: 'All cats are mammals. All mammals breathe air. Therefore all cats breathe air.', options: ['Follows logically', 'Does not follow'], answer: 0, w: 1, domain: 'logic' },
    { q: 'If it rains, the match is cancelled. The match was cancelled. Therefore it rained.', options: ['Follows logically', 'Does not follow'], answer: 1, w: 3, domain: 'logic' },
    { q: 'All Zips are Zaps. No Zaps are Zops. Therefore no Zips are Zops.', options: ['Follows logically', 'Does not follow'], answer: 0, w: 3, domain: 'logic' },
    { q: 'What is 15% of 200?', options: ['25', '30', '35', '40'], answer: 1, w: 2, domain: 'math' },
    { q: 'If 3 pencils cost 45p, how much do 7 pencils cost?', options: ['95p', '100p', '105p', '115p'], answer: 2, w: 1, domain: 'math' },
    { q: 'A train covers 60 km in 40 minutes. What is its speed in km/h?', options: ['80', '85', '90', '100'], answer: 2, w: 3, domain: 'math' },
    { q: 'Which of these letters looks the same when rotated 180°?', options: ['F', 'H', 'G', 'J'], answer: 1, w: 2, domain: 'spatial' },
    { q: 'Rearrange the letters "CIFIPAC" and you get the name of a(n)…', options: ['City', 'Ocean', 'Country', 'Animal'], answer: 1, w: 2, domain: 'spatial' },
    { q: 'How many edges does a cube have?', options: ['8', '10', '12', '16'], answer: 2, w: 2, domain: 'spatial' },
    { q: 'Which number is the odd one out? 121, 144, 169, 180', options: ['121', '144', '169', '180'], answer: 3, w: 2, domain: 'math' },
  ];

  /* ---------------- Baseline EQ mini-assessment ---------------- */
  const baselineEQ = [
    {
      q: 'A close friend messages you: "Honestly, today was awful. Everything went wrong." What do you reply first?',
      options: [
        { text: '"That sounds really rough — want to tell me what happened?"', pts: 2 },
        { text: '"You should make a list of what went wrong and fix each thing."', pts: 1 },
        { text: '"Everyone has bad days, it\'ll pass."', pts: 0 },
        { text: '"At least it\'s almost the weekend!"', pts: 0 },
      ],
    },
    {
      q: 'A colleague reads your feedback on their work and goes quiet for the rest of the day. What is the most emotionally aware read?',
      options: [
        { text: 'They may be feeling hurt or embarrassed and need time to process.', pts: 2 },
        { text: 'They agree with everything and have nothing to add.', pts: 0 },
        { text: 'They are probably just busy.', pts: 1 },
        { text: 'They are being unprofessional.', pts: 0 },
      ],
    },
    {
      q: 'You feel a flash of anger during a discussion. The most emotionally intelligent first move is to…',
      options: [
        { text: 'Notice the anger, take a breath, and name what triggered it before responding.', pts: 2 },
        { text: 'Say exactly what you feel in the moment so it doesn\'t build up.', pts: 0 },
        { text: 'Suppress it and pretend everything is fine.', pts: 0 },
        { text: 'Leave the conversation without explanation.', pts: 1 },
      ],
    },
    {
      q: 'Your teammate seems unusually withdrawn this week. You…',
      options: [
        { text: 'Find a private moment and ask gently how they\'re doing.', pts: 2 },
        { text: 'Ask them in front of the group what\'s wrong.', pts: 0 },
        { text: 'Wait — if it matters, they\'ll bring it up.', pts: 1 },
        { text: 'Tell others you\'re worried about them.', pts: 0 },
      ],
    },
    {
      q: 'You receive unexpectedly harsh criticism on work you are proud of. Your strongest first response is to…',
      options: [
        { text: 'Pause, let the sting settle, then look for what is useful in it.', pts: 2 },
        { text: 'Defend each point immediately.', pts: 0 },
        { text: 'Dismiss the critic as having bad taste.', pts: 0 },
        { text: 'Quietly decide to never share work with them again.', pts: 1 },
      ],
    },
  ];

  /* ---------------- Word analogies ---------------- */
  const analogies = {
    easy: [
      { q: 'Bird : Nest :: Bee : ?', options: ['Flower', 'Hive', 'Honey', 'Wing'], answer: 1 },
      { q: 'Hot : Cold :: Up : ?', options: ['Above', 'Sky', 'Down', 'Tall'], answer: 2 },
      { q: 'Puppy : Dog :: Kitten : ?', options: ['Cat', 'Mouse', 'Fur', 'Lion'], answer: 0 },
      { q: 'Pen : Write :: Knife : ?', options: ['Sharp', 'Cut', 'Kitchen', 'Metal'], answer: 1 },
      { q: 'Eye : See :: Ear : ?', options: ['Sound', 'Head', 'Hear', 'Listen carefully'], answer: 2 },
      { q: 'Fish : Water :: Bird : ?', options: ['Air', 'Feather', 'Tree', 'Egg'], answer: 0 },
    ],
    medium: [
      { q: 'Author : Novel :: Composer : ?', options: ['Piano', 'Symphony', 'Orchestra', 'Concert'], answer: 1 },
      { q: 'Drought : Rain :: Famine : ?', options: ['Hunger', 'Crops', 'Food', 'Poverty'], answer: 2 },
      { q: 'Thermometer : Temperature :: Barometer : ?', options: ['Weather', 'Pressure', 'Wind', 'Humidity'], answer: 1 },
      { q: 'Sapling : Tree :: Foal : ?', options: ['Stable', 'Colt', 'Horse', 'Farm'], answer: 2 },
      { q: 'Scalpel : Surgeon :: Chisel : ?', options: ['Sculptor', 'Carpenter\'s bench', 'Hammer', 'Stone'], answer: 0 },
      { q: 'Miser : Generous :: Coward : ?', options: ['Fearful', 'Brave', 'Weak', 'Careful'], answer: 1 },
      { q: 'Chapter : Book :: Movement : ?', options: ['Dance', 'Symphony', 'Exercise', 'Protest'], answer: 1 },
      { q: 'Ice : Cold :: Ember : ?', options: ['Fire', 'Ash', 'Hot', 'Coal'], answer: 2 },
    ],
    hard: [
      { q: 'Ephemeral : Permanent :: Turbulent : ?', options: ['Stormy', 'Calm', 'Chaotic', 'Fast'], answer: 1 },
      { q: 'Candid : Deceptive :: Humble : ?', options: ['Modest', 'Shy', 'Arrogant', 'Quiet'], answer: 2 },
      { q: 'Archipelago : Islands :: Constellation : ?', options: ['Sky', 'Stars', 'Planets', 'Galaxy'], answer: 1 },
      { q: 'Prologue : Epilogue :: Dawn : ?', options: ['Morning', 'Sunrise', 'Dusk', 'Night'], answer: 2 },
      { q: 'Cartographer : Maps :: Lexicographer : ?', options: ['Laws', 'Dictionaries', 'Lectures', 'Letters'], answer: 1 },
      { q: 'Parsimonious : Spend :: Taciturn : ?', options: ['Speak', 'Listen', 'Move', 'Smile'], answer: 0 },
      { q: 'Antidote : Poison :: Solace : ?', options: ['Comfort', 'Grief', 'Peace', 'Solitude'], answer: 1 },
      { q: 'Obfuscate : Clarify :: Squander : ?', options: ['Waste', 'Spend', 'Conserve', 'Lose'], answer: 2 },
    ],
  };

  /* ---------------- Odd one out ---------------- */
  const oddOneOut = {
    easy: [
      { options: ['Apple', 'Banana', 'Carrot', 'Mango'], answer: 2, why: 'Carrot is a vegetable; the others are fruits.' },
      { options: ['Chair', 'Table', 'Bed', 'Spoon'], answer: 3, why: 'A spoon is cutlery; the others are furniture.' },
      { options: ['Red', 'Blue', 'Circle', 'Green'], answer: 2, why: 'Circle is a shape; the others are colours.' },
      { options: ['Dog', 'Cat', 'Sparrow', 'Rabbit'], answer: 2, why: 'A sparrow is a bird; the others are mammals.' },
      { options: ['Two', 'Four', 'Seven', 'Eight'], answer: 2, why: 'Seven is odd; the others are even.' },
      { options: ['Hammer', 'Screwdriver', 'Nail', 'Wrench'], answer: 2, why: 'A nail is a fastener; the others are tools.' },
    ],
    medium: [
      { options: ['Copper', 'Iron', 'Plastic', 'Zinc'], answer: 2, why: 'Plastic is synthetic; the others are metals.' },
      { options: ['Violin', 'Cello', 'Trumpet', 'Guitar'], answer: 2, why: 'A trumpet is brass; the others have strings.' },
      { options: ['Mercury', 'Venus', 'Sun', 'Mars'], answer: 2, why: 'The Sun is a star; the others are planets.' },
      { options: ['Whisper', 'Shout', 'Murmur', 'Glance'], answer: 3, why: 'A glance is visual; the others are vocal.' },
      { options: ['Triangle', 'Square', 'Pentagon', 'Cylinder'], answer: 3, why: 'A cylinder is 3-D; the others are flat shapes.' },
      { options: ['Happy', 'Elated', 'Furious', 'Cheerful'], answer: 2, why: 'Furious is anger; the others are joy.' },
    ],
    hard: [
      { options: ['Ephemeral', 'Fleeting', 'Transient', 'Eternal'], answer: 3, why: 'Eternal means lasting forever; the others mean short-lived.' },
      { options: ['Metaphor', 'Simile', 'Hyperbole', 'Paragraph'], answer: 3, why: 'A paragraph is structure; the others are figures of speech.' },
      { options: ['Femur', 'Tibia', 'Ulna', 'Fibula'], answer: 2, why: 'The ulna is in the arm; the others are leg bones.' },
      { options: ['Cumulus', 'Stratus', 'Cirrus', 'Tsunami'], answer: 3, why: 'A tsunami is a wave; the others are cloud types.' },
      { options: ['Kilogram', 'Metre', 'Litre', 'Temperature'], answer: 3, why: 'Temperature is a quantity; the others are units.' },
      { options: ['Democracy', 'Monarchy', 'Oligarchy', 'Bureaucracy'], answer: 3, why: 'Bureaucracy describes administration; the others describe who holds power.' },
    ],
  };

  /* ---------------- Syllogisms / logic statements ---------------- */
  const syllogisms = {
    easy: [
      { q: 'All roses are flowers. Some flowers fade quickly. Therefore some roses fade quickly.', answer: 1, why: 'The quick-fading flowers might not include any roses.' },
      { q: 'All cats are mammals. All mammals breathe air. Therefore all cats breathe air.', answer: 0, why: 'A classic valid chain: cats → mammals → air-breathers.' },
      { q: 'If the alarm rings, Maya wakes up. The alarm rang. Therefore Maya woke up.', answer: 0, why: 'This is modus ponens — the condition happened, so the result follows.' },
      { q: 'All fish live in water. A dolphin lives in water. Therefore a dolphin is a fish.', answer: 1, why: 'Living in water doesn\'t make something a fish — the arrow only points one way.' },
      { q: 'No triangles have four sides. This shape has four sides. Therefore this shape is not a triangle.', answer: 0, why: 'Valid: having four sides rules out being a triangle.' },
    ],
    medium: [
      { q: 'No reptiles are warm-blooded. All snakes are reptiles. Therefore no snakes are warm-blooded.', answer: 0, why: 'Valid: snakes inherit the property of all reptiles.' },
      { q: 'Some doctors are surgeons. All surgeons are skilled. Therefore some doctors are skilled.', answer: 0, why: 'Valid: the doctors who are surgeons must be skilled.' },
      { q: 'If it rains, the match is cancelled. The match was cancelled. Therefore it rained.', answer: 1, why: 'Affirming the consequent — the match could be cancelled for other reasons.' },
      { q: 'If a number is divisible by 6, it is divisible by 3. 15 is divisible by 3. Therefore 15 is divisible by 6.', answer: 1, why: 'The rule runs one way only; 15 is a counterexample.' },
      { q: 'All squares are rectangles. Some rectangles are wide. Therefore some squares are wide.', answer: 1, why: 'The wide rectangles might not include any squares.' },
      { q: 'Everyone who studied passed. Priya passed. Therefore Priya studied.', answer: 1, why: 'People might pass without studying — the statement doesn\'t exclude it.' },
    ],
    hard: [
      { q: 'All bloops are razzies. No razzies are lazzies. Therefore no bloops are lazzies.', answer: 0, why: 'Valid: every bloop is a razzie, and no razzie can be a lazzie.' },
      { q: 'Some artists are dreamers. Some dreamers are planners. Therefore some artists are planners.', answer: 1, why: 'The two "some" groups may not overlap at all.' },
      { q: 'Every gline is a trop. Some trops are not glines. Kip is a trop. Therefore Kip is a gline.', answer: 1, why: 'Kip could be one of the trops that is not a gline.' },
      { q: 'No honest people tell lies. Some politicians tell lies. Therefore some politicians are not honest.', answer: 0, why: 'Valid: the lying politicians cannot be in the honest group.' },
      { q: 'If Zoe is late, she takes a taxi. Zoe did not take a taxi. Therefore Zoe was not late.', answer: 0, why: 'Modus tollens — if the result didn\'t happen, the condition can\'t have.' },
      { q: 'All flurbs are green or tall. Bo the flurb is not green. Therefore Bo is tall.', answer: 0, why: 'Valid: with "green" ruled out, "tall" is the only option left.' },
    ],
  };

  /* ---------------- Daily EQ scenarios (situational judgment) ---------------- */
  const eqScenarios = [
    {
      title: 'The meeting snap',
      situation: 'In a team meeting, a normally friendly coworker snaps at you over a small question. Everyone goes quiet.',
      options: [
        { text: 'Stay calm, let it pass in the moment, and check in with them privately afterwards.', pts: 2, why: 'Best: you avoid escalating publicly and give them space to explain — the snap probably wasn\'t about you.' },
        { text: 'Snap back so they know they can\'t talk to you that way.', pts: 0, why: 'Escalates the conflict in front of everyone and closes the door to understanding what happened.' },
        { text: 'Apologise immediately and stop asking questions for the rest of the meeting.', pts: 0, why: 'Over-accommodating — you take blame that likely isn\'t yours and lose your voice.' },
        { text: 'Ask the group to move on and never mention it again.', pts: 1, why: 'Defuses the moment, but the tension with your coworker stays unresolved.' },
      ],
    },
    {
      title: 'The serial canceller',
      situation: 'A good friend cancels your plans last-minute for the third time this month, with a vague excuse.',
      options: [
        { text: 'Tell them honestly that the pattern stings, and ask if everything is okay with them.', pts: 2, why: 'Best: honest about your feelings and curious about theirs — repeated cancelling often signals something deeper.' },
        { text: 'Stop inviting them and quietly downgrade the friendship.', pts: 0, why: 'They never learn there was a problem, and you lose a friend to an unspoken resentment.' },
        { text: 'Reply "no worries!!" and pretend it doesn\'t bother you.', pts: 0, why: 'Suppressing irritation repeatedly turns it into resentment.' },
        { text: 'Tell them cancelling again means they owe you dinner.', pts: 1, why: 'Keeps it light and signals mild displeasure, but dodges the real conversation.' },
      ],
    },
    {
      title: 'Credit where due',
      situation: 'In a group call, a teammate presents an idea you shared with them privately last week — as their own. People love it.',
      options: [
        { text: 'Add to the discussion constructively, then talk to the teammate one-on-one about what happened.', pts: 2, why: 'Best: you stay composed publicly and address the real issue directly with the person responsible.' },
        { text: 'Interrupt to announce it was your idea.', pts: 0, why: 'Even when true, a public claim reads as territorial and puts everyone in an awkward spot.' },
        { text: 'Say nothing, ever — keeping the peace matters more.', pts: 0, why: 'Silence teaches the teammate the behaviour works, and your resentment will grow.' },
        { text: 'Message your manager immediately to report the teammate.', pts: 1, why: 'Sometimes needed eventually, but escalating before speaking to them skips the fairest step.' },
      ],
    },
    {
      title: 'Venting, not solving',
      situation: 'A friend is venting about their stressful job. You can see three obvious things they could fix.',
      options: [
        { text: 'Listen first, reflect what you hear, and ask if they want ideas before offering any.', pts: 2, why: 'Best: most people venting need to feel heard first — advice lands only when invited.' },
        { text: 'Jump straight into your three-point fix plan.', pts: 1, why: 'Well-intentioned, but unsolicited fixes often make the venter feel unheard.' },
        { text: 'Top their story with your own worse work story.', pts: 0, why: 'Redirects attention to you exactly when they need it.' },
        { text: 'Tell them they should just quit.', pts: 0, why: 'Dramatic advice with none of the listening — dismisses the complexity of their situation.' },
      ],
    },
    {
      title: 'Your mistake',
      situation: 'You realise a mistake you made last week caused extra work for two teammates. Nobody knows it was you yet.',
      options: [
        { text: 'Tell them promptly, apologise, and offer to help clear the extra work.', pts: 2, why: 'Best: owning it fast builds trust — hiding it risks far more than the mistake itself.' },
        { text: 'Fix what you can quietly and hope nobody traces it back.', pts: 1, why: 'Repairs some damage but leaves teammates confused, and discovery later erodes trust.' },
        { text: 'Wait to see if anyone notices before saying anything.', pts: 0, why: 'Passivity here converts an honest mistake into a hidden one.' },
        { text: 'Mention it casually as a "systems problem" without owning your part.', pts: 0, why: 'Deflecting blame onto the process is a subtle form of dishonesty people can sense.' },
      ],
    },
    {
      title: 'The distant evening',
      situation: 'Your partner (or closest friend) is unusually quiet and short with you tonight. You haven\'t argued.',
      options: [
        { text: 'Say gently, "You seem quiet tonight — anything on your mind?" and accept it if they\'re not ready to talk.', pts: 2, why: 'Best: names what you notice without accusation, and respects their pace.' },
        { text: 'Demand to know what\'s wrong right now.', pts: 0, why: 'Pressure usually shuts people down further.' },
        { text: 'Get quiet and short in return.', pts: 0, why: 'Mirroring withdrawal doubles the distance instead of bridging it.' },
        { text: 'Give them space all evening and say nothing at all.', pts: 1, why: 'Space is kind, but with no signal that you noticed, they may read it as indifference.' },
      ],
    },
    {
      title: 'Public disagreement',
      situation: 'A colleague publicly challenges your proposal in a meeting, and their tone is sharper than needed.',
      options: [
        { text: 'Address the substance calmly, acknowledge any fair points, and let the tone go for now.', pts: 2, why: 'Best: engaging the argument and not the attitude keeps you credible and the discussion useful.' },
        { text: 'Match their tone to show confidence.', pts: 0, why: 'Two sharp tones turn a critique into a duel — the room stops hearing content.' },
        { text: 'Withdraw the proposal to end the discomfort.', pts: 0, why: 'Conceding to tone rather than argument teaches people that sharpness beats you.' },
        { text: 'Answer briefly, then suggest you two take details offline.', pts: 1, why: 'Reasonable, though it can look evasive if their points deserved a public answer.' },
      ],
    },
    {
      title: 'The quiet newcomer',
      situation: 'A new member of your group chat or team has been silent for two weeks. Everyone else is chatty.',
      options: [
        { text: 'Reach out to them directly with a low-pressure, friendly message or question.', pts: 2, why: 'Best: a private, easy opening is far less intimidating than being spotlighted in the group.' },
        { text: 'Call them out in the group: "You\'re so quiet! Say something!"', pts: 0, why: 'Public attention on their silence usually deepens it.' },
        { text: 'Assume they\'ll join in when they\'re ready and do nothing.', pts: 1, why: 'Sometimes true, but a small welcome dramatically shortens the wait.' },
        { text: 'Ask someone else what the newcomer\'s deal is.', pts: 0, why: 'Talking about them instead of to them builds distance, not connection.' },
      ],
    },
    {
      title: 'Overloaded',
      situation: 'Three people ask you for favours in one afternoon. You\'re already stretched thin and feel your patience fraying.',
      options: [
        { text: 'Notice the overload, and give honest, kind answers about what you can and can\'t do this week.', pts: 2, why: 'Best: self-awareness plus clear boundaries protects both the work and the relationships.' },
        { text: 'Say yes to everyone and quietly seethe.', pts: 0, why: 'Overcommitting turns helpfulness into resentment, and the quality of your help drops.' },
        { text: 'Ignore the messages until tomorrow.', pts: 1, why: 'A pause can help, but silence leaves people hanging — a quick "I\'ll reply tomorrow" costs little.' },
        { text: 'Tell the third person exactly how annoying all these requests are.', pts: 0, why: 'The third asker pays for the first two — misdirected frustration damages an innocent relationship.' },
      ],
    },
    {
      title: 'Exciting news, private doubts',
      situation: 'A friend excitedly shares a big plan you privately think is risky and half-baked.',
      options: [
        { text: 'Celebrate their excitement first, ask curious questions, and share concerns honestly if they ask or when the moment fits.', pts: 2, why: 'Best: enthusiasm and honesty can coexist — questions let them find the gaps themselves.' },
        { text: 'List all the flaws immediately so they don\'t get hurt.', pts: 1, why: 'Honest but poorly timed — criticism at the peak of excitement mostly creates defensiveness.' },
        { text: 'Fake full enthusiasm and keep your doubts forever.', pts: 0, why: 'They lose access to the one perspective that might have helped them.' },
        { text: 'Change the subject.', pts: 0, why: 'Dodging reads as indifference to something they care about.' },
      ],
    },
    {
      title: 'Harsh critique',
      situation: 'You receive blunt, harsh criticism on work you are genuinely proud of.',
      options: [
        { text: 'Let the sting settle before responding, then mine the feedback for anything useful.', pts: 2, why: 'Best: separating the emotional hit from the information is the core skill of receiving feedback.' },
        { text: 'Respond immediately with a defence of every point.', pts: 0, why: 'Answering from the sting usually means arguing, not listening.' },
        { text: 'Decide the critic simply has bad judgment.', pts: 0, why: 'Comforting, but you throw away real signal along with the rude packaging.' },
        { text: 'Thank them politely and never look at the feedback again.', pts: 1, why: 'Graceful on the surface, but the useful parts of the critique go unused.' },
      ],
    },
    {
      title: 'Caught in the middle',
      situation: 'Two friends are in a conflict, and both are venting to you separately about the other.',
      options: [
        { text: 'Listen to each with empathy, avoid taking sides or relaying messages, and gently encourage them to talk directly.', pts: 2, why: 'Best: you support both people without becoming the channel that keeps the conflict alive.' },
        { text: 'Agree with whichever friend you\'re currently talking to.', pts: 0, why: 'Feels supportive in the moment, but you\'re now telling two contradictory stories.' },
        { text: 'Relay each friend\'s complaints to the other to speed things up.', pts: 0, why: 'Messages passed through a third party lose nuance and gain heat.' },
        { text: 'Tell them both to stop involving you.', pts: 1, why: 'A fair boundary, though delivered without warmth it can read as abandoning them.' },
      ],
    },
    {
      title: 'Rude to the waiter',
      situation: 'At dinner, someone in your group is repeatedly rude to the waiter — snapping fingers, sharp remarks.',
      options: [
        { text: 'Counteract it in the moment with visible courtesy to the waiter, and mention it privately to your companion later.', pts: 2, why: 'Best: the waiter gets immediate relief, and the feedback lands where it can be heard — in private.' },
        { text: 'Publicly scold your companion at the table.', pts: 1, why: 'Defends the waiter, but public shaming usually triggers defensiveness rather than change.' },
        { text: 'Say nothing — it\'s not your business.', pts: 0, why: 'Silence in the presence of repeated rudeness reads as endorsement.' },
        { text: 'Apologise to the waiter on their behalf, loudly, mid-meal.', pts: 0, why: 'Turns the meal into a spectacle and speaks for someone who should speak for themselves.' },
      ],
    },
    {
      title: 'The dimmed colleague',
      situation: 'A colleague who is usually upbeat has been flat and disengaged for days. Today they made an uncharacteristic mistake.',
      options: [
        { text: 'Check in privately: "You haven\'t seemed yourself lately — how are you doing?"', pts: 2, why: 'Best: naming the change privately, without judgment, opens a door they can choose to walk through.' },
        { text: 'Report the mistake to their manager so it gets addressed.', pts: 0, why: 'Escalating a symptom while ignoring the person misses what\'s actually happening.' },
        { text: 'Joke about the mistake in the group channel to lighten the mood.', pts: 0, why: 'Public humour about a struggling person\'s error usually lands as humiliation.' },
        { text: 'Quietly fix the mistake and say nothing.', pts: 1, why: 'Kind, but invisible kindness doesn\'t reach the person who may need support.' },
      ],
    },
    {
      title: 'The repeat borrower',
      situation: 'A sibling asks to borrow money again. They haven\'t repaid the last loan, and you feel a knot forming in your stomach.',
      options: [
        { text: 'Notice the knot, then have an honest conversation about the pattern before deciding.', pts: 2, why: 'Best: the body\'s signal is data — naming the pattern honestly respects both of you.' },
        { text: 'Lend it again to avoid an awkward conversation.', pts: 0, why: 'Avoiding ten awkward minutes buys months of quiet resentment.' },
        { text: 'Refuse with a lecture about their life choices.', pts: 0, why: 'The boundary is fair; the contempt attached to it damages the relationship.' },
        { text: 'Say you need a day to think about it.', pts: 1, why: 'Buying time is wise, but eventually the pattern still needs naming.' },
      ],
    },
    {
      title: 'The envy flash',
      situation: 'A friend announces a big success — the exact thing you\'ve been working toward. You feel a hot flash of envy alongside your happiness for them.',
      options: [
        { text: 'Congratulate them warmly, and privately acknowledge the envy as information about what you want.', pts: 2, why: 'Best: envy handled with self-awareness becomes motivation instead of poison.' },
        { text: 'Point out the luck involved in their success.', pts: 0, why: 'Diminishing their achievement leaks the envy onto them.' },
        { text: 'Congratulate them, then beat yourself up for feeling envious at all.', pts: 1, why: 'The outward response is right, but shaming yourself for a normal emotion helps no one.' },
        { text: 'Distance yourself from them for a while.', pts: 0, why: 'Punishing the friendship for your own feeling costs you both.' },
      ],
    },
    {
      title: 'Idea rejected',
      situation: 'You pitch an idea you believe in, and the group rejects it quickly — almost dismissively. The meeting moves on.',
      options: [
        { text: 'Let the disappointment register, then later ask one member for specific feedback on why it didn\'t land.', pts: 2, why: 'Best: you honour the feeling and convert rejection into information.' },
        { text: 'Re-raise the idea twice more in the same meeting.', pts: 0, why: 'Pushing against a fresh "no" without new information reads as not listening.' },
        { text: 'Decide the group never takes you seriously and stop contributing.', pts: 0, why: 'One data point becomes a story that silences you — a heavy price for one rejection.' },
        { text: 'Accept it silently and move on without ever asking why.', pts: 1, why: 'Composed, but you learn nothing that would make the next pitch land better.' },
      ],
    },
    {
      title: 'The group chat misfire',
      situation: 'You send a joke in the group chat. One friend replies with a single "wow." — and you suspect the joke landed badly for them.',
      options: [
        { text: 'Message them privately: "That may have come out wrong — I\'m sorry if it stung."', pts: 2, why: 'Best: a fast, private repair keeps a small misfire from hardening into a grievance.' },
        { text: 'Explain the joke to the whole group at length.', pts: 1, why: 'Shows you care, but public re-litigating often deepens the awkwardness.' },
        { text: 'Ignore it — people are too sensitive.', pts: 0, why: 'Dismissing the reaction guarantees you never learn whether harm was done.' },
        { text: 'Delete the message and pretend it never happened.', pts: 0, why: 'Erasing the evidence isn\'t the same as repairing the moment.' },
      ],
    },
  ];

  /* ---------------- Emotion-read vignettes ---------------- */
  const emotionReads = [
    { text: 'Sam triple-checks the email, hovers over "send" for a full minute, then closes the laptop without sending.', options: ['Boredom', 'Anxiety', 'Anger', 'Excitement'], answer: 1, why: 'Checking, hesitating, and avoiding are classic anxiety behaviours.' },
    { text: 'After the results are announced, Dana smiles and claps — but her jaw is tight and she leaves as soon as it\'s polite to.', options: ['Genuine joy', 'Disappointment masked by politeness', 'Fear', 'Surprise'], answer: 1, why: 'The mismatch between the social smile and the tight jaw plus quick exit signals masked disappointment.' },
    { text: 'Leo keeps re-reading the message from his old friend, starts typing a reply three times, and finally puts the phone face-down.', options: ['Ambivalence', 'Rage', 'Amusement', 'Boredom'], answer: 0, why: 'Repeated starting and stopping shows two feelings pulling in opposite directions — ambivalence.' },
    { text: 'Mia talks faster and faster about her new project, interrupts herself, laughs, and forgets to eat her lunch.', options: ['Anxiety', 'Excitement', 'Anger', 'Sadness'], answer: 1, why: 'Fast speech, self-interruption, and forgotten lunch point to absorbed excitement.' },
    { text: 'Asked how he\'s doing after the layoff, Raj shrugs and says "fine" — then spends the afternoon reorganising the garage for the third time this week.', options: ['Contentment', 'Restless distress kept busy', 'Joy', 'Jealousy'], answer: 1, why: 'Compulsive busywork after a loss is often distress being managed by motion.' },
    { text: 'Every time her sister\'s new job comes up, Ana changes the subject and checks her phone.', options: ['Envy or discomfort', 'Delight', 'Calm', 'Curiosity'], answer: 0, why: 'Consistent avoidance of one specific topic usually marks discomfort — often envy when it\'s a peer\'s success.' },
    { text: 'Tom laughs at every joke tonight, a little too loudly, and keeps refilling everyone\'s glasses before his own is empty.', options: ['Ease', 'Overcompensating unease', 'Boredom', 'Serenity'], answer: 1, why: 'Excess cheer and busy hosting can be a cover for social unease.' },
    { text: 'After winning the award, Priya thanks everyone quickly and immediately credits three colleagues by name.', options: ['Guilt', 'Gratitude with humility', 'Resentment', 'Indifference'], answer: 1, why: 'Fast, specific credit-sharing signals genuine gratitude and humility rather than deflection.' },
    { text: 'Ken answers every question in the interview with one flat word and keeps glancing at the clock.', options: ['Engagement', 'Disengagement or reluctance', 'Elation', 'Awe'], answer: 1, why: 'Minimal answers plus clock-watching signal someone who doesn\'t want to be there.' },
    { text: 'Reading the text, Jo\'s eyes widen, she covers her mouth, and then immediately calls her best friend.', options: ['Shock seeking support', 'Boredom', 'Contentment', 'Suspicion'], answer: 0, why: 'Widened eyes and the urgent call show shock and an instinct to co-process it.' },
    { text: 'Since the argument, Dev replies to his roommate only in short, formal sentences and does his dishes immediately, loudly.', options: ['Warmth', 'Cold anger', 'Fear', 'Happiness'], answer: 1, why: 'Exaggerated formality and pointed noise are anger expressed without words.' },
    { text: 'Grandma keeps the broken watch on her wrist and touches it whenever her late husband is mentioned.', options: ['Nostalgic grief', 'Annoyance', 'Confusion', 'Pride'], answer: 0, why: 'Keeping and touching a memento tied to a lost person expresses grief and remembrance.' },
    { text: 'When his idea is praised in the meeting, Omar looks down, half-smiles, and quickly asks what everyone thinks of the next item.', options: ['Bashful pleasure', 'Fury', 'Boredom', 'Disgust'], answer: 0, why: 'Looking down with a suppressed smile while deflecting attention is pleased embarrassment.' },
    { text: 'Nina rewrites her toast for her best friend\'s wedding five times and practices it in the mirror at midnight.', options: ['Indifference', 'Loving nervousness', 'Resentment', 'Exhaustion'], answer: 1, why: 'The effort shows how much she cares; the midnight rehearsal shows the nerves that come with it.' },
  ];

  /* ---------------- Journal prompts ---------------- */
  const journalPrompts = [
    'What is one assumption you made today that turned out to be wrong — and what did it teach you?',
    'Describe a moment today when you felt your mood shift. What triggered it, and how did you respond?',
    'What problem are you currently avoiding, and what is the smallest first step you could take on it?',
    'Write about a conversation from this week from the other person\'s point of view.',
    'What did you do today purely out of habit? Would you choose it deliberately?',
    'Describe something ordinary you noticed today as if explaining it to someone who has never seen it.',
    'What emotion visited you most often today? Where did you feel it in your body?',
    'What is a belief you hold that you\'ve never seriously questioned? Question it for a few sentences.',
    'What was the best decision you made this week, and what made it good — luck or judgment?',
    'Who challenged you recently? What might be true in their view that you resist seeing?',
    'If today had a title like a book chapter, what would it be — and why?',
    'What are you looking forward to, and what does that anticipation feel like?',
    'Describe a small kindness you witnessed or performed today. What effect did it have?',
    'What drained your energy today, and what restored it?',
    'Write about something you changed your mind about — recently or long ago. What moved you?',
    'What would your closest friend say is your blind spot? Do they have a point?',
    'What did you learn today — however small? How does it connect to something you already knew?',
    'Recall a moment you felt truly focused recently. What conditions made it possible?',
    'What conversation do you need to have but keep postponing? What are you afraid might happen?',
    'Describe today\'s weather — inside your head.',
    'What is one thing you would tell yourself from one year ago?',
  ];

  /* ---------------- Word lists for journal analysis ---------------- */
  const advancedVocab = [
    'meticulous','nuance','nuanced','ambivalent','ambivalence','resilient','resilience','pragmatic','introspective','introspection',
    'catalyst','paradox','paradoxical','ephemeral','tenacity','tenacious','cultivate','discern','discerning','intricate',
    'profound','subtle','subtlety','deliberate','coherent','coherence','empathy','empathetic','perspective','momentum',
    'clarity','apprehensive','apprehension','vulnerability','vulnerable','gratitude','equilibrium','autonomy','integrity','curiosity',
    'perception','perceptive','cognition','cognitive','rationale','hypothesis','synthesis','synthesize','trajectory','latent',
    'salient','arbitrary','pertinent','tangible','intangible','elusive','mundane','novelty','disposition','temperament',
    'conviction','skepticism','skeptical','humility','candor','candour','prudent','prudence','foresight','hindsight',
    'retrospect','articulate','eloquent','succinct','verbose','tangent','tangential','analogy','analogous','metaphor',
    'inference','infer','deduce','deduction','extrapolate','juxtapose','juxtaposition','dichotomy','spectrum','threshold',
    'incremental','iterate','iteration','consolidate','crystallize','recalibrate','underlying','implicit','explicit','inherent',
    'intrinsic','extrinsic','superficial','holistic','systemic','pervasive','transient','fleeting','enduring','persistent',
    'deliberation','contemplate','contemplation','rumination','ruminate','epiphany','revelation','insight','insightful','intuition',
    'intuitive','counterintuitive','rational','irrational','bias','biased','heuristic','fallacy','premise','conjecture',
    'plausible','implausible','feasible','viable','futile','arduous','tedious','exhilarating','daunting','formidable',
    'serendipity','serendipitous','melancholy','wistful','poignant','bittersweet','cathartic','catharsis','visceral','palpable',
    'restorative','invigorating','depleted','replenish','sustainable','equanimity','composure','fortitude','audacity','reticent',
    'reticence','earnest','sincerity','authenticity','authentic','integral','pivotal','quintessential','emblematic','archetype',
    'paradigm','trajectory','confluence','divergence','convergence','symbiosis','reciprocal','reciprocity','magnanimous','altruism',
    'altruistic','benevolent','pernicious','insidious','ubiquitous','ambiguous','ambiguity','obscure','lucid','lucidity',
  ];

  const emotionVocab = [
    'happy','sad','angry','afraid','fearful','worried','anxious','frustrated','grateful','content',
    'overwhelmed','curious','hopeful','proud','embarrassed','resentful','calm','uneasy','excited','disappointed',
    'ashamed','relieved','envious','jealous','tender','confident','lonely','inspired','irritated','nostalgic',
    'serene','apprehensive','elated','melancholy','guilty','vulnerable','joyful','weary','restless','optimistic',
    'pessimistic','bitter','compassionate','insecure','fulfilled','discouraged','energized','energised','drained','conflicted',
    'hurt','betrayed','appreciated','valued','dismissed','ignored','loved','annoyed','stressed','peaceful',
    'thrilled','defeated','motivated','hesitant','torn','moved','touched','uplifted','deflated','tense',
  ];

  const insightMarkers = [
    'because','realize','realized','realise','realised','wonder','wondering','perhaps','maybe','however',
    'although','though','consider','considering','instead','learned','learnt','pattern','assume','assumed',
    'assumption','question','questioning','reflect','reflecting','reflection','notice','noticed','noticing','means',
    'therefore','implies','suggests','connect','connection','underneath','actually','surprised','expected','unexpected',
    'if i','next time','in hindsight','looking back','on reflection','i think','i felt','i feel','which means','the reason',
  ];

  const perspectiveMarkers = [
    'they might','she might','he might','they may','she may','he may','their perspective','their point of view',
    'in their shoes','from their side','they felt','they feel','they probably','she probably','he probably',
    'from where they stand','they were likely','it makes sense that they','i can see why',
  ];

  return {
    baselineIQ, baselineEQ, analogies, oddOneOut, syllogisms,
    eqScenarios, emotionReads, journalPrompts,
    advancedVocab, emotionVocab, insightMarkers, perspectiveMarkers,
  };
})();
