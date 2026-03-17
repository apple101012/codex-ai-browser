export interface ControlState {
  activeProfileId: string | null;
  updatedAt: string;
}

export class ActiveControlStore {
  private activeProfileId: string | null = null;
  private updatedAt = new Date().toISOString();

  getState(): ControlState {
    return {
      activeProfileId: this.activeProfileId,
      updatedAt: this.updatedAt
    };
  }

  setActiveProfile(profileId: string): ControlState {
    this.activeProfileId = profileId;
    this.updatedAt = new Date().toISOString();
    return this.getState();
  }

  clearActiveProfile(): ControlState {
    this.activeProfileId = null;
    this.updatedAt = new Date().toISOString();
    return this.getState();
  }
}

