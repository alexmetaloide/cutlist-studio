import {optimize} from './optimizer.js';
self.onmessage=({data})=>{try{self.postMessage({result:optimize(data)});}catch(error){self.postMessage({error:error.message});}};
