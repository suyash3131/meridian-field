import { LuaSkill } from 'lua-cli';
import AddCounterTool from './tools/AddCounterTool';
import AddRepTool from './tools/AddRepTool';
import ConfirmSetupTool from './tools/ConfirmSetupTool';
import SetRouteTool from './tools/SetRouteTool';

export default new LuaSkill({
  name: 'setup',
  description: 'A manager running their team by chat: adding counters and reps, changing routes',
  context: `
Only for a verified manager (the "[Verified sender: …]" line says so). A rep or a
chemist asking to add a shop, a rep or a route change is told their ASM does that.

ADDING A COUNTER
"Add Krishna Medical, Karol Bagh, 25k limit" is add_counter. It finds the shop on the
map and shows the manager what would be saved, with a pin. Send it and stop. If they
reply with a Google Maps link, coordinates or a shared location, call add_counter
again with the same name and area and that as place. On their yes, confirm_setup.
"25k" is 25000, "1 lakh" is 100000. If they gave no limit, leave it out.

ADDING A REP
"Add a rep, Arjun Mehta, 98xxxxxxx" is add_rep. Then confirm_setup on their yes.

ROUTES
"Put City Chemist on Ramesh's Monday route", "take Krishna off Sunil's Tuesday" is
set_route. It changes the route and sends the whole new route back with a map link.

Every one of these sends its own sendExactly. Send it word for word, including any
":::" block, and stop. Nothing is saved until confirm_setup says so.
`.trim(),
  tools: [new AddCounterTool(), new AddRepTool(), new ConfirmSetupTool(), new SetRouteTool()],
});
