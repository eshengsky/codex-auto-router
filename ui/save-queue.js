// One shared revision covers all templates. Serialize writes so independent
// blur/change events never race with each other or reuse an obsolete revision.
export class SaveQueue {
  constructor({revision,send,onSaved,onStatus,onError}) {
    Object.assign(this,{revision,send,onSaved,onStatus,onError});
    this.pending=new Map();this.failed=new Map();this.running=false;
  }
  enqueue(key,body) {
    const previous=this.pending.get(key);
    if(body.activate){
      this.desiredTemplate=body.count;
      for(const [other,job] of this.pending)if(other!==key && job.activate)this.pending.set(other,{...job,activate:false});
      for(const [other,failure] of this.failed)if(other!==key && failure.body.activate)this.failed.set(other,{...failure,body:{...failure.body,activate:false}});
    }
    this.pending.delete(key);
    // A later ordinary edit must not discard an explicit activation waiting in the queue.
    this.pending.set(key,{...body,...(previous?.activate?{activate:true}:{})});
    this.failed.delete(key);this.onError([...this.failed.values()]);
    return this.drain();
  }
  async drain() {
    if(this.running)return;
    this.running=true;this.onStatus(true);
    try {
      while(this.pending.size){
        const [key,body]=this.pending.entries().next().value;this.pending.delete(key);
        try {
          const saved=await this.send({...body,revision:this.revision});
          this.revision=saved.revision;this.failed.delete(key);this.onSaved(saved,body);
        } catch(error) {
          // Keep the failed edit for explicit retry; never fetch a new revision
          // and overwrite another window's work automatically.
          const retryBody=body.activate && body.count!==this.desiredTemplate?{...body,activate:false}:body;
          this.failed.set(key,{key,body:retryBody,message:error.message});
        }
        this.onError([...this.failed.values()]);
      }
    } finally {this.running=false;this.onStatus(false);}
  }
  retry() {for(const {key,body} of this.failed.values())if(!this.pending.has(key))this.pending.set(key,body);return this.drain();}
}
