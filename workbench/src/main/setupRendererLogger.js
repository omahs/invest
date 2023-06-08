import { ipcMain } from 'electron';

import { ipcMainChannels } from './ipcMainChannels';
import { getLogger } from './logger';

const logger = getLogger('renderer');

export default function setupRendererLogger() {
  ipcMain.on(ipcMainChannels.LOGGER, (level, message) => {
    switch (level) {
      case 'debug':
        logger.debug(message);
        break;
      case 'info':
        logger.info(message);
        break;
      case 'warning':
        logger.warning(message);
        break;
      case 'error':
        logger.error(message);
        break;
      default:
        logger.info(message);
    }
  });

  ipcMain.handle(ipcMainChannels.GET_ELECTRON_LOG_PATH, () => (
    logger.transports.file.getFile().path
  ));
}
