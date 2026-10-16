import {optimize} from './optimizer.js?v=mdf-1';
self.onmessage=({data})=>{try{self.postMessage({result:optimize(data)});}catch(error){self.postMessage({error:error.message});}};
