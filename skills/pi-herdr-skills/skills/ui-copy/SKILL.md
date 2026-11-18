---
name: ui-copy
description: "Write and review interface text in a product UI: remove filler, redundant hints and restated labels while keeping required warnings, error text, labels and accessibility instructions intact. Use when adding, reviewing or trimming microcopy, helper text, hint text, empty states, tooltips, toasts, dialog bodies, menu captions or settings descriptions."
---

# Interface copy

Use this for text inside a product UI. It is not a style guide for chat replies
(that is `talk-human`), and not for documentation, release notes or marketing pages.

The rule is easy to state and easy to get wrong:

> **Say less. Never remove a line the user must read to act safely.**

Most interface text is written to make a control feel finished. That is the wrong
reason to write it. Text earns its place by changing what the user does next, or by
carrying a consequence they cannot see.

## 1. The default is no text

Start from nothing and add words only when they pass a test. This is the explicit
advice in published guidance, not a house preference:

- "So start with less. If you're creating a form, start with some simple questions
  and only add help text if user research shows that you need it."
  — [GOV.UK Service Manual, Writing for user interfaces](https://www.gov.uk/service-manual/design/writing-for-user-interfaces)
- "Check each word to be sure it needs to be there. If you can use fewer words, do
  so." — [Apple Human Interface Guidelines, Writing](https://developer.apple.com/design/human-interface-guidelines/writing)
- "Publish only what's needed to meet that user need and nothing more."
  — [GDS, Write content to meet user needs](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/meet-user-needs/)

## 2. Two tests before you keep a line

**The restatement test.** Can the user already recover this information from the
current screen state — the label, the value, the selection, the icon, the count? If
yes, the line is restating and it goes.

Apply it per claim, not per string. A single caption often carries two statements
with different standing, and deleting the whole caption to remove the first one
takes the second with it. Check the code for what the other half actually means
before you decide.

**The action test.** Does the line change what the user does next, or tell them
something they could not otherwise know — a consequence, a limit, a required format,
a loss they would not predict? If yes, it stays. If no, it goes.

If the line passes the action test but the wording is vague, rewrite it. Do not
delete it.

## 3. Filler patterns to cut

| Pattern | Example | Why it fails | Usual fix |
| --- | --- | --- | --- |
| Restated state bundled with a consequence | `Saved view: All products · working changes are not saved automatically.` | The first half repeats the active row and its checkmark; the second half states a real loss on reload | Split them: drop the restated name, keep the consequence, and show it only when it applies |
| Explain-the-obvious | `Choose an option from the list to filter.` | The control and its label already say this. | Delete. |
| Feature narration | `Use this panel to manage your products.` | Describes the panel to someone already in it. | Delete, or move to a first-run empty state. |
| Hedge | `Please note that you can also press Enter.` | "Please note" and "also" carry nothing. | `Enter` in the hint, or nothing. |
| Reassurance | `Don't worry, nothing is deleted yet.` | Adds anxiety it claims to remove. | Delete unless a real loss is possible, then state the loss. |
| Duplicated label | Label `Email`, hint `Enter your email address` | The label is the hint. | Delete the hint. |
| Always-on hint for a rare case | Permanent `Maximum 200 characters` under a field that rarely reaches it | Taxes every user for a minority case. | Show it near the limit, or on error. |
| Placeholder carrying the label | Field with no label, placeholder `Search` | Placeholder disappears once typed. | Add a real label; placeholder becomes an example, if anything. |

Filler is not free. It consumes the scan budget the user needed for the parts that
matter: "Redundant text not only takes valuable screen space, but weakens the
effectiveness of the important ideas or actions that you are trying to convey."
— [Microsoft, User Interface Text](https://learn.microsoft.com/en-us/windows/win32/uxguide/text-ui).
And "Users didn't want to bother with extra, secondary stuff ... They just wanted to
know the main points." —
[NN/g, Mobile Content: If in Doubt, Leave It Out](https://www.nngroup.com/articles/condense-mobile-content/).

## 4. Text that must stay

This is the part to protect when someone invokes "brevity". Each line below is a
requirement, not decoration.

**Labels and instructions needed to supply input.** WCAG 2.2 SC 3.3.2 (Level A)
requires that "Labels or instructions are provided when content requires user
input", and that they "need to be persistently available to users"
([Understanding 3.3.2](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html)).
The same page warns against over-correction in the other direction: "Too much
information or instruction can be just as harmful as too little." Trim, then keep.
GOV.UK adds the accessibility reason to keep hints short rather than delete them:
"Screen readers will read out the entire text when users interact with the form
element" ([Question pages](https://design-system.service.gov.uk/patterns/question-pages/)).

**Errors, described in text.** SC 3.3.1 (Level A): "If an input error is
automatically detected, the item that is in error is identified and the error is
described to the user in text"
([Understanding 3.3.1](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html)).
An icon, a red border or a shake is not a substitute. SC 3.3.3 (Level AA) also
requires known correction suggestions
([Understanding 3.3.3](https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html)).
Never delete an error string to tidy a layout.

**Help that appears on hover or focus.** SC 1.4.13 (Level AA) applies
dismissible, hoverable and persistent conditions when hover or focus reveals extra
content
([Understanding 1.4.13](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)).
If you remove such help instead, you must replace a *required* instruction with
something persistent.

**Consequential or irreversible actions.** Keep the warning and make it specific:
what happens, to what, and whether it can be undone. "When people take an uncommon
destructive action that they can't undo, it's important to display an alert in case
they initiated the action accidentally." —
[Apple HIG, Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts).

**Hidden state with a real cost.** Autosave off, unsaved work, a background job that
will overwrite something, a scope that is not what the user assumes, a mode that
changes what a click does. These look like filler and are not: the user cannot infer
them, and the cost of not knowing is lost work.

**Security, legal and consent text. Refusals and failures.** Keep them; tighten the
wording only if nothing legally or operationally required is dropped.

**Content a screen-reader user needs in text.** Descriptions for icon-only controls,
live-region announcements, `aria-describedby` targets. Removing visible text that an
`aria-describedby` pointed at breaks the control silently.

## 5. Where to fix it instead of deleting it

Often the text is compensating for a weak affordance. Prefer the structural fix:

- A restated state means the control does not show its own state. Fix the control
  (`aria-current`, a checkmark, a selected style) and delete the caption.
- An instruction that repeats the label means the label is vague. Rewrite the label.
- A warning about a consequence means the flow is surprising. Consider asking
  before the action instead of explaining after.
- A hint for a rare case should be conditional — shown when the case applies, not
  permanently. SC 3.3.2 explicitly permits making instructions available on focus
  or on request "especially for when they are long and verbose".

## 6. Nuance: when repetition is correct

"Do not duplicate information" is guidance, not a law. Two published exceptions
matter:

- Keeping the user in their task: "It's okay to duplicate small amounts of
  information already on GOV.UK if it means keeping the user inside the
  transaction." —
  [GOV.UK Service Manual, Content and transactions](https://www.gov.uk/service-manual/design/govuk-content-transactions)
- Clarity before brevity: "Out of the 3 C's, concision should come second, meaning
  that a few extra words can be included if they increase the understandability of a
  phrase or sentence." —
  [NN/g, The 3 C's of Informational Microcopy](https://www.nngroup.com/articles/3-cs-microcopy/)

So the test is never "is it short?" It is "does this line do work the user needs
here, now, without leaving this screen?"

## 7. Editing rules

- Put the important words first: "Space is at a premium with user interfaces. So put
  the important words first and drop any unnecessary words." — GOV.UK, *Writing for
  user interfaces*.
- Keep the necessary part: "Don't sacrifice necessary information and presentation,
  but don't use more words than you have to." —
  [Microsoft, Writing style](https://learn.microsoft.com/en-us/windows/apps/design/style/writing-style)
- One idea per sentence. Active voice. Present tense. Imperative for instructions.
- Use one term for one thing across the surface. Do not rotate synonyms for variety.
- Do not add "please", "simply", "just", "easily", "note that", "in order to".
- Keep exact strings: field names, units, limits, error codes, key names. Copy them,
  never paraphrase.
- Write plain sentences with articles and verbs. Terse fragments read as machine
  output and cost comprehension.

## 8. Review procedure

When auditing a surface, do it in this order. The order is the safeguard.

1. **List the protected lines first.** Enumerate every warning, error, refusal,
   required instruction, destructive confirmation, live-region message and
   `aria-describedby` target. Write them down before editing anything.
2. **Classify each remaining line** as restatement, explanation, reassurance,
   narration, or genuine information. Only the last category survives by default.
3. **Apply the two tests** in §2 to every candidate.
4. **Choose the fix**: delete, move to the conditional case, or fix the affordance
   (§5).
5. **Re-read the result as a first-time user** who has never seen this screen. Ask
   what they no longer know. If the answer includes a consequence or a required
   input format, you cut too much.
6. **Check the trimmed state is still announced.** If a line was the only textual
   carrier of a state, keep it in text even when the visual cue remains.
7. **Report what you deliberately kept** and why. A copy review that only lists
   deletions is incomplete.

## 9. Red flags in your own review

- You removed a line because the menu "looked cluttered".
- You rewrote a warning into something shorter and softer.
- You replaced a label with a placeholder to save vertical space.
- You deleted text that was the only place an irreversible action was named.
- You applied a word limit instead of a judgement.
- You deleted a caption without checking whether an `aria-describedby` or a
  `role="alert"` referenced it.
- You trimmed copy on a screen you never ran.

If any of these happened, go back to §4 and restore.

## 10. Sources and their limits

Primary guidance used above:

- GOV.UK Service Manual, *Writing for user interfaces* —
  <https://www.gov.uk/service-manual/design/writing-for-user-interfaces>
- GOV.UK Design System, *Question pages* (hint text) —
  <https://design-system.service.gov.uk/patterns/question-pages/>
- GDS, *Write content to meet user needs* —
  <https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/meet-user-needs/>
- NN/g, *How Users Read on the Web* —
  <https://www.nngroup.com/articles/how-users-read-on-the-web/>
- NN/g, *Mobile Content: If in Doubt, Leave It Out* —
  <https://www.nngroup.com/articles/condense-mobile-content/>
- NN/g, *Blah-Blah Text: Keep, Cut, or Kill?* —
  <https://www.nngroup.com/articles/blah-blah-text-keep-cut-or-kill/>
- NN/g, *The 3 C's of Informational Microcopy* —
  <https://www.nngroup.com/articles/3-cs-microcopy/>
- Material Design 3, *Text fields* (supporting text) —
  <https://m3.material.io/components/text-fields/guidelines>
- Microsoft, *User Interface Text* —
  <https://learn.microsoft.com/en-us/windows/win32/uxguide/text-ui>
- Microsoft, *Writing style* —
  <https://learn.microsoft.com/en-us/windows/apps/design/style/writing-style>
- Apple HIG, *Writing* —
  <https://developer.apple.com/design/human-interface-guidelines/writing>
- Apple HIG, *Alerts* —
  <https://developer.apple.com/design/human-interface-guidelines/alerts>
- WCAG 2.2 Understanding, 3.3.2, 3.3.1, 3.3.3, 1.4.13 —
  <https://www.w3.org/WAI/WCAG22/Understanding/>
- W3C WAI, *Forms Tutorial: Instructions* —
  <https://www.w3.org/WAI/tutorials/forms/instructions/>
- Mailchimp Content Style Guide, *Writing Goals and Principles* —
  <https://styleguide.mailchimp.com/writing-principles/>

Limits to keep in mind:

- The Microsoft *User Interface Text* page is legacy Windows 7 guidance. Microsoft
  notes that its presentation and examples do not reflect newer Windows guidance.
  Its redundancy principle is still consistent with the current *Writing style*
  page, which is what §7 quotes for the balance rule.
- Material 3's "ideally be one line" describes supporting text anatomy, not a hard
  limit that overrides clarity.
- Apple HIG and Material pages ship as rendered pages whose text sometimes does not
  extract; cite what you actually read, not a search snippet.
- These sources agree more than they disagree, but none of them removes the need for
  a judgement call on a specific screen. A rule applied without looking at the screen
  is how necessary warnings get deleted.
