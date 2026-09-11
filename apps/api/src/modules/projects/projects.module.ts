import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  // Projects sign the cover thumbnails on the sites list.
  imports: [UploadsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
