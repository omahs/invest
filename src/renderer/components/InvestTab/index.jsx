import path from 'path';
import React from 'react';
import PropTypes from 'prop-types';
import { ipcRenderer, shell } from 'electron';

import TabPane from 'react-bootstrap/TabPane';
import TabContent from 'react-bootstrap/TabContent';
import TabContainer from 'react-bootstrap/TabContainer';
import Nav from 'react-bootstrap/Nav';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';

import ModelStatusAlert from './ModelStatusAlert';
import SetupTab from '../SetupTab';
import LogTab from '../LogTab';
import ResourcesLinks from '../ResourcesLinks';
import { getSpec } from '../../server_requests';
import { ipcMainChannels } from '../../../main/ipcMainChannels';

const logger = window.Workbench.getLogger(__filename.split('/').slice(-1)[0]);

/** Get an invest model's ARGS_SPEC when a model button is clicked.
 *
 * @param {string} modelName - as in a model name appearing in `invest list`
 * @returns {object} destructures to:
 *   { modelSpec, argsSpec, uiSpec }
 */
async function investGetSpec(modelName) {
  const spec = await getSpec(modelName);
  if (spec) {
    const { args, ...modelSpec } = spec;
    const uiSpecs = require('../../ui_config');
    const uiSpec = uiSpecs[modelName];
    if (uiSpec) {
      return { modelSpec: modelSpec, argsSpec: args, uiSpec: uiSpec };
    }
    logger.error(`no UI spec found for ${modelName}`);
  } else {
    logger.error(`no args spec found for ${modelName}`);
  }
  return undefined;
}

function handleOpenWorkspace(logfile) {
  shell.showItemInFolder(logfile);
}

/**
 * Render an invest model setup form, log display, etc.
 * Manage launching of an invest model in a child process.
 * And manage saves of executed jobs to a persistent store.
 */
export default class InvestTab extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      activeTab: 'setup',
      modelSpec: null, // ARGS_SPEC dict with all keys except ARGS_SPEC.args
      argsSpec: null, // ARGS_SPEC.args, the immutable args stuff
      uiSpec: null,
      logStdErr: '', // stderr data from the invest subprocess
      executeClicked: false,
    };

    this.investExecute = this.investExecute.bind(this);
    this.switchTabs = this.switchTabs.bind(this);
    this.terminateInvestProcess = this.terminateInvestProcess.bind(this);
    this.investLogfileCallback = this.investLogfileCallback.bind(this);
    this.investStdErrCallback = this.investStdErrCallback.bind(this);
    this.investExitCallback = this.investExitCallback.bind(this);
  }

  async componentDidMount() {
    const { job } = this.props;
    const {
      modelSpec, argsSpec, uiSpec
    } = await investGetSpec(job.modelRunName);
    this.setState({
      modelSpec: modelSpec,
      argsSpec: argsSpec,
      uiSpec: uiSpec,
    }, () => { this.switchTabs('setup'); });
    const { jobID } = this.props;
    ipcRenderer.on(`invest-logging-${jobID}`, this.investLogfileCallback);
    ipcRenderer.on(`invest-stderr-${jobID}`, this.investStdErrCallback);
    ipcRenderer.on(`invest-exit-${jobID}`, this.investExitCallback);
  }

  componentWillUnmount() {
    ipcRenderer.removeListener(
      `invest-logging-${this.props.jobID}`, this.investLogfileCallback
    );
    ipcRenderer.removeListener(
      `invest-stderr-${this.props.jobID}`, this.investStdErrCallback
    );
    ipcRenderer.removeListener(
      `invest-exit-${this.props.jobID}`, this.investExitCallback
    );
  }

  investLogfileCallback(event, logfile) {
    // Only now do we know for sure the process is running
    this.props.updateJobProperties(this.props.jobID, {
      logfile: logfile,
      status: 'running',
    });
  }

  investStdErrCallback(event, data) {
    let { logStdErr } = this.state;
    logStdErr += data;
    this.setState({
      logStdErr: logStdErr,
    });
  }

  investExitCallback(event, code) {
    const { logStdErr } = this.state;
    const {
      jobID,
      updateJobProperties,
      saveJob,
    } = this.props;
    const status = (code === 0) ? 'success' : 'error';
    let finalTraceback = '';
    if (logStdErr) {
      // Get the last meaningful line of stderr for display in an Alert.
      // The PyInstaller exe will always emit a final 'Failed ...' message
      // after an uncaught exception.
      const stdErrLines = logStdErr.split(/\r\n|\r|\n/);
      while (
        !finalTraceback || finalTraceback.includes(
          "Failed to execute script 'cli' due to unhandled exception!"
        )
      ) {
        finalTraceback = stdErrLines.pop();
      }
    }
    updateJobProperties(jobID, {
      status: status,
      finalTraceback: finalTraceback,
    });
    saveJob(jobID);
    this.setState({
      executeClicked: false
    });
  }

  /** Spawn a child process to run an invest model via the invest CLI.
   *
   * e.g. `invest -vvv run <model> --headless -d <datastack path>`
   *
   * When the process starts (on first stdout callback), job metadata is saved
   * and local state is updated to display the invest log.
   * When the process exits, job metadata is updated with final status of run.
   *
   * @param {object} argsValues - the invest "args dictionary"
   *   as a javascript object
   */
  async investExecute(argsValues) {
    this.setState({
      executeClicked: true, // disable the button until invest exits
      logStdErr: '', // reset because we could be re-running a job
    });
    const {
      job,
      jobID,
      investSettings,
      updateJobProperties,
    } = this.props;
    const args = { ...argsValues };
    // Not strictly necessary, but resolving to a complete path
    // here to be extra certain we avoid unexpected collisions
    // of workspaceHash, which uniquely ids a job in the database
    // in part by it's workspace directory.
    args.workspace_dir = path.resolve(argsValues.workspace_dir);

    updateJobProperties(jobID, {
      argsValues: args,
      status: undefined, // in case of re-run, clear an old status
    });

    ipcRenderer.send(
      ipcMainChannels.INVEST_RUN,
      job.modelRunName,
      this.state.modelSpec.pyname,
      args,
      investSettings.loggingLevel,
      jobID
    );
    this.switchTabs('log');
  }

  terminateInvestProcess() {
    // For the benefit of displaying user-feedback, mock some stdErr
    // here before sending the kill signal. This way the exit listener will
    // have some stderr data to work with.
    this.setState({
      logStdErr: 'Run Canceled'
    }, () => {
      ipcRenderer.send(
        ipcMainChannels.INVEST_KILL, this.props.jobID
      );
    });
  }

  /** Change the tab that is currently visible.
   *
   * @param {string} key - the value of one of the Nav.Link eventKey.
   */
  switchTabs(key) {
    this.setState(
      { activeTab: key }
    );
  }

  render() {
    const {
      activeTab,
      modelSpec,
      argsSpec,
      uiSpec,
      executeClicked,
    } = this.state;
    const {
      status,
      modelRunName,
      argsValues,
      logfile,
      finalTraceback,
    } = this.props.job;
    const { jobID } = this.props;

    // Don't render the model setup & log until data has been fetched.
    if (!modelSpec) {
      return (<div />);
    }

    const logDisabled = !logfile;
    const sidebarSetupElementId = `sidebar-setup-${jobID}`;
    const sidebarFooterElementId = `sidebar-footer-${jobID}`;

    return (
      <TabContainer activeKey={activeTab} id="invest-tab">
        <Row className="flex-nowrap">
          <Col
            className="invest-sidebar-col"
          >
            <Nav
              className="flex-column"
              id="vertical tabs"
              variant="pills"
              activeKey={activeTab}
              onSelect={this.switchTabs}
            >
              <Nav.Link eventKey="setup">
                Setup
              </Nav.Link>
              <div
                className="sidebar-setup"
                id={sidebarSetupElementId}
              />
              <Nav.Link eventKey="log" disabled={logDisabled}>
                Log
              </Nav.Link>
            </Nav>
            <div className="sidebar-row">
              <ResourcesLinks
                moduleName={modelRunName}
                docs={modelSpec.userguide_html}
              />
            </div>
            <div
              className="sidebar-row sidebar-footer"
              id={sidebarFooterElementId}
            >
              {
                status
                  ? (
                    <ModelStatusAlert
                      status={status}
                      finalTraceback={finalTraceback}
                      handleOpenWorkspace={() => handleOpenWorkspace(logfile)}
                      terminateInvestProcess={this.terminateInvestProcess}
                    />
                  )
                  : null
              }
            </div>
          </Col>
          <Col className="invest-main-col">
            <TabContent>
              <TabPane eventKey="setup" title="Setup">
                <SetupTab
                  pyModuleName={modelSpec.pyname}
                  modelName={modelSpec.model_name}
                  argsSpec={argsSpec}
                  uiSpec={uiSpec}
                  argsInitValues={argsValues}
                  investExecute={this.investExecute}
                  nWorkers={this.props.investSettings.nWorkers}
                  sidebarSetupElementId={sidebarSetupElementId}
                  sidebarFooterElementId={sidebarFooterElementId}
                  executeClicked={this.state.executeClicked}
                />
              </TabPane>
              <TabPane eventKey="log" title="Log">
                <LogTab
                  logfile={logfile}
                  executeClicked={executeClicked}
                  jobID={jobID}
                  pyModuleName={modelSpec.pyname}
                />
              </TabPane>
            </TabContent>
          </Col>
        </Row>
      </TabContainer>
    );
  }
}

InvestTab.propTypes = {
  job: PropTypes.shape({
    modelRunName: PropTypes.string.isRequired,
    modelHumanName: PropTypes.string.isRequired,
    argsValues: PropTypes.object,
    logfile: PropTypes.string,
    status: PropTypes.string,
    finalTraceback: PropTypes.string,
  }).isRequired,
  jobID: PropTypes.string.isRequired,
  investSettings: PropTypes.shape({
    nWorkers: PropTypes.string,
    loggingLevel: PropTypes.string,
  }).isRequired,
  saveJob: PropTypes.func.isRequired,
  updateJobProperties: PropTypes.func.isRequired,
};
