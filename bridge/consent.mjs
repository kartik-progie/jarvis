import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

const DESCRIPTION = `Report that the user has agreed to the action you are holding.

When an action is held pending their agreement, say what you are about to do
and ask. Then listen to their whole reply and decide what it means:

- They agree, however they phrase it ("yes", "go on", "yes, open it",
  "that's the one") -> call this tool, then do the thing.
- They refuse ("no", "don't", "leave it") -> do not call this tool. Say you
  have left it, and stop.
- They change the request ("not that one, the one with the blue icon") ->
  do not call this tool. Work out the corrected action, propose THAT, and ask
  again. The held action is not what they wanted.
- They say something unrelated -> drop it and answer what they actually said.

\`said\` must be their words, copied from what you heard, not a paraphrase and
not your own summary. It is checked against what the microphone actually
delivered, so an invented or reworded quote is refused. This is deliberate:
your judgement decides what their reply meant, but only their own speech can
authorise anything.`

/**
 * The one tool that can release a held action.
 *
 * The gate itself stays in the bridge — a pattern match on the reply is what
 * this replaces, not the gate. A regex can accept "yes" and reject "yes, open
 * it", and it can never understand "not that one, the one with the blue icon".
 * Only the model has heard the sentence and can tell approval from correction.
 *
 * So the decision moves to the model and the proof stays here: it must quote
 * the user, the quote is checked against the utterance the interface actually
 * delivered, and the grant is still bound to the exact pending action. A web
 * page can print "the user approves" as loudly as it likes; it is not speech,
 * it never becomes an utterance, and nothing it says can be quoted from one.
 */
export function consentServer(claim) {
  return createSdkMcpServer({
    name: 'jarvis_consent',
    version: '1.0.0',
    instructions:
      'Releasing an action that is waiting on the user. Call `confirm` once ' +
      'they have agreed, quoting what they said.',
    // Never deferred behind tool search: a held action is already mid-
    // conversation, and the model going looking for this would read as JARVIS
    // ignoring a yes.
    alwaysLoad: true,
    tools: [
      tool(
        'confirm',
        DESCRIPTION,
        {
          said: z
            .string()
            .min(1)
            .describe("The user's own words agreeing, verbatim."),
        },
        async ({ said }) => {
          const verdict = claim(said)
          return {
            content: [
              {
                type: 'text',
                text: verdict.ok
                  ? `Agreed. ${verdict.tool} is released — carry it out now. ` +
                    'This covers that one action only.'
                  : `Not released: ${verdict.reason}`,
              },
            ],
            isError: !verdict.ok,
          }
        },
      ),
    ],
  })
}
