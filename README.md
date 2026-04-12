# NumBrrs

This is a sveltekit app that is intended to help game players learn NHL player jersey numbers. It will start out easier and get harder to help them learn progressively.

The basic idea is that a game player will be shown a team name and number and have to guess the NHL player's name. Initially, there will be multiple choices they can choose from, starting with 2 at the easiest level and up to the full team roster at the hardest.

Visually, the full team roster will be shown in all cases, with only the options the game player is choosing from highlighted.

Optionally, a game player can have the number of NHL players they have correctly identified be shown in the roster and removed as an option for future guesses to make it easier.

The data for the game should be pulled periodically from the NHL api (described at https://github.com/Zmalski/NHL-API-Reference?tab=readme-ov-file#get-specific-player-info) and cached in the app so that roster changes are reflected over time and don't need app updates.

Visually I'm going for a flashcard theme. The idea is for something themed kind of like a hockey card - initially only seeing team name and number (with colour reflecting the team) and then flipping over with a hockey card type of thing showing the player info and photo.

Optionally, players can login to see their results and how they have improved over time.
