// The narration script, keyed by the caption headline (or, for intro slides, the slide title)
// that it belongs to. Shared by narrate.mjs (speaks and muxes), read-script.mjs (prints it for a
// human to read aloud) and split-vo.mjs (cuts a single human take back into these clips), so
// there is exactly one copy of the words.

export const LINES = {
  // ── Intro ────────────────────────────────────────────────────────────────
  'Every Nigerian household has this conversation.':
    'Every Nigerian middle class household has had this conversation. What did you do with the fifteen thousand naira I gave you yesterday? Parents and business owners hand cash, or an open bank transfer, to the people who spend on their behalf.',
  'Every existing option gives the money away completely.':
    'And every existing option gives the money away completely. Cash leaves no record. A debit card P I N is not a rule. A bank transfer is instant, and instantly out of your hands.',
  'The big wallets all sell the same wallet to everyone.':
    'So why has nobody fixed it? The big wallets all sell the same wallet to everyone, built on a single user thesis. The banks are locked to one customer, one account. Nobody has segmented around delegated control.',
  'The infrastructure that made this impossible is now standard.':
    'What changed is the plumbing. Instant transfer now reaches almost every bank account in Nigeria. Identity enrolment covers most of the adult population. And banking as a service turned a two year build into a few months. The infrastructure tax that killed earlier attempts is gone.',
  'Delegated authority, not delegated access.':
    'Amana is built on one idea: delegated authority, not delegated access. One funded master wallet. A sub-wallet for each person, which is a spending envelope rather than another bank account. Limits, category locks and time windows, enforced on every spend.',
  'Control without the conversation.':
    'What that buys you is control without the conversation. The parent stops policing and starts setting rules. The agent stops justifying every naira. Every spend is auditable the moment it happens.',

  // ── Walkthrough ──────────────────────────────────────────────────────────
  'A parent funds one wallet. Every agent spends under their own limits.':
    'Amana is a controlled-spend wallet for Nigeria. A parent funds one wallet, and every person who spends from it gets their own limits. Everything you are about to see is the real app, running against a live A P I.',
  'The principal signs in with a phone number.':
    'Onboarding is a phone number and a one-time code. There are no passwords anywhere in the product.',
  'First-time signup also captures NIN and BVN.':
    'A first-time signup also captures N I N and B V N: the Nigerian identity numbers a wallet needs before it can hold money.',
  'Creating the household provisions a real bank account.':
    'Creating a household provisions a real bank account. A customer record, and a fundable account number at our banking partner. That account number is the wallet.',
  'Money arrives by bank transfer into that account.':
    'Money arrives the ordinary way, by bank transfer. The credit lands as a signed webhook and posts to a double entry ledger.',
  'The principal issues a one-time pairing code.':
    'To add someone who spends, the parent issues a one-time pairing code. On a phone that code travels by Q R, by N F C tap, or by an S M S link.',
  'The agent signs in on their own phone.':
    'The agent has their own phone and their own login. They never see the master wallet. Only what they have been given.',
  'The agent types the code showing on the parent’s phone.':
    'The code is what binds this device to that household. Nothing else will.',
  'The principal issues a sub-wallet to that agent.':
    'The parent issues a sub-wallet. It is not a bank account. It is a spending envelope drawn against the master wallet, so there is no float to top up, and nothing stranded.',
  'The parent caps what can be spent in a day…':
    'And this is the point of the product. The parent sets the rules. A daily cap, enforced on the server, on every spend. The agent app cannot talk its way past it.',
  '…and locks it to the categories they choose.':
    'Then they lock it down further. Transport, school, market. Anything outside that list is not the agent’s call to make.',
  'Now the agent tries something the rules do not allow.':
    'So watch what happens when the agent tries something outside the rules. Airtime was never on the list.',
  'It is not refused — it is held, and the parent is asked.':
    'It is not refused. It is held, and the parent is asked. That distinction is the whole product: nobody gets stranded at the counter, and nobody has to hand over blanket access to avoid it.',
  'One tap from the parent, and the payment goes through.':
    'One tap from the parent, and the payment goes through. The rule held. The parent decided. And there is nothing to argue about afterwards.',
  'The agent’s phone now shows the sub-wallet it was given.':
    'The agent now sees the sub-wallet they were given. Until the parent issues one, there is nothing to spend from.',
  'Paying a vendor is a normal bank transfer out.':
    'Paying a vendor is a normal bank transfer out. The vendor needs no app and no account with us. Just an account number.',
  'The bank confirms who owns that account before anything moves.':
    'Before anything moves, the bank confirms who owns that account, and the agent sees the real name.',
  'The bank confirms the transfer and the ledger settles.':
    'The bank confirms, and the ledger settles. Double entry postings, both sides accounted for. The agent gets a receipt carrying the N I B S S session I D, the same reference their own bank would show.',
  'The same wallet buys airtime, data, electricity and cable.':
    'The same wallet also buys airtime, data, electricity and cable, paid straight to the biller. No cash, no top up card, no middleman.',
  'And the parent’s category lock reaches this too.':
    'And this is the part that matters. The parent’s category lock reaches these too. Airtime was never on the allowed list, so it is refused, rather than quietly permitted because it happens to be digital.',
  'The parent decides to allow it.':
    'If the parent wants to allow it, that is one tap in the same editor.',
  'And now it goes through.':
    'And now it goes through. Same purchase, same wallet. The only thing that changed is the parent’s rule.',
  // ── The marketplace & the control fusion ─────────────────────────────────
  // Framed as the control primitive pointing outward, not as a shopping feature. The
  // interesting claim is that approving a shop is the SAME act as setting a limit.
  'A marketplace, built out of the same control.':
    'The last piece turns that control outward. Amana has a marketplace of local businesses — salons, clinics, schools, mechanics. Not advertising. Distribution, paid for by the retailer only when someone actually turns up.',
  'Until a parent approves a shop, there is nothing to buy.':
    'And it starts closed. Until a parent approves a shop, the agent sees an empty marketplace. Nobody is upsold anything.',
  'Approving a shop writes a rule.':
    'Here is the part that is hard to copy. When the parent approves a shop, that is not a marketplace setting. It writes a rule into the same rule set that holds the spending limit and the category lock, and the same engine enforces all three. The marketplace and the control system are one thing.',
  'Now the agent sees it — and only it.':
    'Now the agent sees that shop, and only that shop, at the price the retailer set. They were never shown anything they could not buy.',
  'Buying gives them a code, not cash.':
    'Buying gives them a code to show at the counter. The money leaves the wallet now and reaches the shop when the service is actually delivered. If it never is, it expires and the money comes back.',

  'One wallet. Many agents. Every naira under control.':
    'One wallet. Many people spending from it. Every naira under control.',
};
