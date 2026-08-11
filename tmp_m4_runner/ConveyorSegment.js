export class ConveyorSegment {
    config;
    constructor(config) {
        this.config = config;
    }
    get speedFtPerSec() {
        return this.config.speedFtPerMin / 60;
    }
}
export default ConveyorSegment;
