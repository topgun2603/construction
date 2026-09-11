import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  addProjectMediaSchema,
  addProjectMemberSchema,
  createMilestoneSchema,
  createProjectSchema,
  listProjectsQuerySchema,
  reorderMilestonesSchema,
  updateMilestoneSchema,
  reorderProjectMediaSchema,
  updateProjectMediaSchema,
  updateProjectSchema,
  type AddProjectMediaInput,
  type AddProjectMemberInput,
  type CreateMilestoneInput,
  type CreateProjectInput,
  type ListProjectsQuery,
  type ReorderMilestonesInput,
  type UpdateMilestoneInput,
  type UpdateProjectInput,
  type ReorderProjectMediaInput,
  type UpdateProjectMediaInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { CurrentUser, RequiresModule, RequiresPermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@RequiresModule('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @RequiresPermission('projects.view')
  @Get()
  @ApiOperation({ summary: 'List projects visible to the caller' })
  async list(
    @CurrentUser() user: RequestUser,
    @Query(zodBody(listProjectsQuerySchema)) query: ListProjectsQuery,
  ) {
    return this.projects.list(user, query);
  }

  @RequiresPermission('projects.manage')
  @Post()
  @ApiOperation({ summary: 'Create a project' })
  async create(
    @CurrentUser() user: RequestUser,
    @Body(zodBody(createProjectSchema)) body: CreateProjectInput,
  ) {
    return this.projects.create(user, body);
  }

  @RequiresPermission('projects.view')
  @Get(':id')
  @ApiOperation({ summary: 'Read one project' })
  async get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.get(user, id);
  }

  @RequiresPermission('projects.manage')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a project' })
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateProjectSchema)) body: UpdateProjectInput,
  ) {
    return this.projects.update(user, id, body);
  }

  @RequiresPermission('projects.delete')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive a project (soft delete)' })
  async archive(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.projects.archive(user, id);
  }

  @RequiresPermission('projects.view')
  @Get(':id/members')
  @ApiOperation({ summary: 'List project team' })
  async members(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.listMembers(user, id);
  }

  @RequiresPermission('projects.manage')
  @Post(':id/members')
  @ApiOperation({ summary: 'Assign a user to a project' })
  async addMember(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(addProjectMemberSchema)) body: AddProjectMemberInput,
  ) {
    return this.projects.addMember(user, id, body);
  }

  @RequiresPermission('projects.manage')
  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Take a user off a project' })
  async removeMember(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.projects.removeMember(user, id, userId);
  }

  @RequiresPermission('projects.view')
  @Get(':id/milestones')
  @ApiOperation({ summary: 'List milestones' })
  async milestones(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.listMilestones(user, id);
  }

  @RequiresPermission('milestones.manage')
  @Post(':id/milestones')
  @ApiOperation({ summary: 'Add a milestone' })
  async addMilestone(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createMilestoneSchema)) body: CreateMilestoneInput,
  ) {
    return this.projects.addMilestone(user, id, body);
  }

  /*
   * Reorder is declared before the `:milestoneId` routes on purpose: Nest matches in
   * declaration order, so a literal segment registered after a parameter segment
   * would be swallowed by it and "reorder" would arrive as a milestone id.
   */
  @RequiresPermission('milestones.manage')
  @Patch(':id/milestones/reorder')
  @ApiOperation({ summary: 'Reorder the timeline' })
  @HttpCode(204)
  async reorderMilestones(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(reorderMilestonesSchema)) body: ReorderMilestonesInput,
  ): Promise<void> {
    await this.projects.reorderMilestones(user, id, body);
  }

  @RequiresPermission('milestones.manage')
  @Patch(':id/milestones/:milestoneId')
  @ApiOperation({ summary: 'Edit a milestone or mark it complete' })
  async updateMilestone(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body(zodBody(updateMilestoneSchema)) body: UpdateMilestoneInput,
  ) {
    return this.projects.updateMilestone(user, id, milestoneId, body);
  }

  @RequiresPermission('milestones.manage')
  @Delete(':id/milestones/:milestoneId')
  @ApiOperation({ summary: 'Remove a milestone' })
  @HttpCode(204)
  async deleteMilestone(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
  ): Promise<void> {
    await this.projects.deleteMilestone(user, id, milestoneId);
  }

  /*
   * Site media. Reading needs only `projects.view` — a client should be able to see photographs of
   * their own building. Adding and removing need `projects.manage`, because these are the site's
   * record rather than one person's snapshots.
   */

  @RequiresPermission('projects.view')
  @Get(':id/media')
  @ApiOperation({ summary: 'Photos and videos of this site' })
  media(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.projects.listMedia(user, id);
  }

  @RequiresPermission('projects.manage')
  @Post(':id/media')
  @ApiOperation({ summary: 'Attach an uploaded photo or video' })
  addMedia(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(addProjectMediaSchema)) body: AddProjectMediaInput,
  ) {
    return this.projects.addMedia(user, id, body);
  }

  /**
   * A PUT because it replaces the arrangement rather than nudging one file: sending the same order
   * twice leaves the site exactly as it was, which is what a drag that got retried needs.
   */
  @RequiresPermission('projects.manage')
  @Put(':id/media/order')
  @ApiOperation({ summary: 'Rearrange the photos and videos of this site' })
  reorderMedia(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(reorderProjectMediaSchema)) body: ReorderProjectMediaInput,
  ) {
    return this.projects.reorderMedia(user, id, body);
  }

  @RequiresPermission('projects.manage')
  @Patch(':id/media/:mediaId')
  @ApiOperation({ summary: 'Caption a photo or video' })
  updateMedia(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Body(zodBody(updateProjectMediaSchema)) body: UpdateProjectMediaInput,
  ) {
    return this.projects.updateMedia(user, id, mediaId, body);
  }

  @RequiresPermission('projects.manage')
  @Delete(':id/media/:mediaId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a photo or video' })
  async removeMedia(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ): Promise<void> {
    await this.projects.removeMedia(user, id, mediaId);
  }

}
