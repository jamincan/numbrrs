import { createHockeyTechAdapter } from './hockeytech';

// The key is the publicly documented one used by the league's own site; see
// https://github.com/IsabelleLefebvre97/PWHL-Data-Reference
export const pwhlAdapter = createHockeyTechAdapter({
	id: 'pwhl',
	clientCode: 'pwhl',
	apiKey: '446521baf8c38984'
});
