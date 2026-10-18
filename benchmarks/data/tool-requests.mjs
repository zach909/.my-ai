// The tool-request data used by tool_selection.mjs and self_improvement.mjs (one copy, so both measure the same thing).
// TOOLS: id -> { c: consequential, d: description }. D[tool] = { train, val, para, novel } phrasings.
export const TOOLS = {
  web_search: { c: false, d: 'search the web for information online' },
  read_file: { c: false, d: 'read and show the contents of a file' },
  write_file: { c: true, d: 'write or save text into a file' },
  run_command: { c: true, d: 'run a shell command in the terminal' },
  send_email: { c: true, d: 'send an email message to someone' },
  calendar_add: { c: true, d: 'add an event or appointment to the calendar' },
  calculator: { c: false, d: 'calculate arithmetic and maths' },
  weather: { c: false, d: 'get the weather forecast for a place' },
};
export const D = {
  web_search: { train: ['search the web for pasta recipes', 'look up the latest news about the election', 'google the opening hours of the museum', 'find information online about solar panels'],
    val: ['can you search for flights to Rome', 'look online for reviews of this laptop'], para: ['do a web search on electric cars', 'search online for cheap hotels'],
    novel: ['what do people say on the internet about electric bikes', 'I need to dig up info on the history of Rome from the net'] },
  read_file: { train: ['read the file notes.txt', 'show me the contents of report.md', 'open config.json and tell me what is inside', 'what does the log file say'],
    val: ['display the text in todo.txt', 'print the file readme'], para: ['read the document summary.txt', 'show what is in data.csv'],
    novel: ['I would like to see what I wrote in my diary file', 'peek inside that spreadsheet on my desktop'] },
  write_file: { train: ['write hello world to out.txt', 'save this text to a file called memo.txt', 'create a new file named plan.md with these notes', 'overwrite config.json with the new settings'],
    val: ['put this paragraph into draft.txt', 'store these numbers in results.csv'], para: ['write the summary to summary.md', 'save my notes in a file'],
    novel: ['jot this down in a document on disk', 'persist the following text to storage'] },
  run_command: { train: ['run ls -la in the terminal', 'execute the command git status', 'run the shell command df -h', 'open a terminal and run whoami'],
    val: ['run npm test', 'execute uname -a'], para: ['run the command pwd', 'execute ps aux in the shell'],
    novel: ['kick off the build script from my shell', 'fire up the backup program via command line'] },
  send_email: { train: ["send an email to Bob saying I will be late", 'email the report to my boss', 'compose a message to alice@example.com about the meeting', 'mail the invoice to the client'],
    val: ['write an email to Sam', 'email Jane the schedule'], para: ['send Bob an email about lunch', 'email my manager the update'],
    novel: ['drop a line to my landlord about the leak', 'let my team know by electronic mail that I am out sick'] },
  calendar_add: { train: ['add a meeting with Sam tomorrow at 3pm to my calendar', 'schedule a dentist appointment for Friday', 'put lunch with Jane on my calendar on Monday', 'create a calendar event for the team call'],
    val: ['book a call with the client next week', 'add an event for my birthday'], para: ['schedule a meeting for Tuesday at noon', 'add a reminder to my calendar for the gym'],
    novel: ['pencil in coffee with Dana next Thursday', 'block off Wednesday afternoon for deep work'] },
  calculator: { train: ['what is 15 times 23', 'calculate 144 divided by 12', 'compute the square root of 81', 'add 250 and 175'],
    val: ['what is 7 plus 9 times 2', 'work out 20 percent of 350'], para: ['calculate 12 times 12', 'what is 1000 minus 357'],
    novel: ['how much is a dozen dozens', 'if I split 90 dollars three ways what does each get'] },
  weather: { train: ['what is the weather in Paris', 'will it rain tomorrow in London', 'how hot is it in Madrid today', 'give me the forecast for Berlin'],
    val: ['is it going to snow in Oslo', 'what is the temperature outside in Rome'], para: ['weather forecast for Tokyo', 'is it sunny in Lisbon today'],
    novel: ['should I bring an umbrella to Seattle', 'do I need a coat in Chicago this weekend'] },
};
export const NONE_TRAIN = ['tell me a joke', 'what is the capital of France', 'explain how photosynthesis works', 'thanks, that was helpful', 'who wrote Hamlet', 'how are you today'];
export const NONE_VAL = ['hello there', 'what is a black hole', 'give me advice on studying', 'what is your favourite colour'];
export const NONE_TEST = ['what is the meaning of life', 'write a poem about autumn', 'summarize the plot of Star Wars', 'translate good morning into Spanish', 'tell me about your day', 'why is the sky blue',
  'send my regards to your family', 'I read a good book yesterday', 'what should I run for breakfast', 'can you explain what an email is'];
export const AMBIG_VAL = ['go ahead', 'handle that for me', 'do that'];
export const AMBIG_TEST = ['do it', 'can you help me with that?', 'send it', 'run that', 'open it', 'do the thing we talked about', 'yes please go ahead', 'use the tool'];
export const INVALID_VAL = ['use the time machine', 'activate the hyperdrive'];
export const INVALID_TEST = ['use the teleporter tool to move me to Paris', 'launch the nuclear missiles', 'call the quantum_oracle tool', 'order a pizza with the food_delivery tool', 'control the robot arm', 'book a flight using the airline tool'];
export const COMBO_VAL = [['read report.md and send it by email to Sam', ['read_file', 'send_email']], ['work out 9 times 9 and put it in a file', ['calculator', 'write_file']], ['look up the weather in Oslo and add a reminder to my calendar', ['weather', 'calendar_add']]];
export const COMBO = [['read notes.txt and email it to Bob', ['read_file', 'send_email']], ['calculate 12 times 12 and write the answer to result.txt', ['calculator', 'write_file']],
  ['check the weather in Rome and add a trip to my calendar', ['weather', 'calendar_add']], ['run ls in the terminal and save the output to a file', ['run_command', 'write_file']],
  ['search the web for pasta recipes and email me the best one', ['web_search', 'send_email']], ['read todo.txt then schedule the first task on my calendar', ['read_file', 'calendar_add']]];

