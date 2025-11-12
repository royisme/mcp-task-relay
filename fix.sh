#!/bin/bash
# Fix job-manager.ts
sed -i 's/  JobRecord,//' src/core/job-manager.ts
sed -i 's/  private readonly artifactsRepo: ArtifactsRepository;//' src/core/job-manager.ts
sed -i 's/private readonly db: Database,/db: Database,/' src/core/job-manager.ts
sed -i 's/private readonly artifacts: ArtifactsService,/_artifacts: ArtifactsService,/' src/core/job-manager.ts
sed -i 's/this.artifactsRepo = new ArtifactsRepository(db);//' src/core/job-manager.ts
sed -i 's/const listResult = this.jobsRepo.list({ state, limit, offset });/const filters = state !== undefined ? { state, limit, offset } : { limit, offset };\n    const listResult = this.jobsRepo.list(filters);/' src/core/job-manager.ts
