# coding=UTF-8
# -----------------------------------------------
# Generated by InVEST 3.10.1 on Tue Mar  8 15:14:58 2022
# Model: Habitat Risk Assessment

import logging
import os
import shutil
import sys
import time

import natcap.invest.hra
import natcap.invest.hra2
import natcap.invest.utils

LOGGER = logging.getLogger(__name__)
root_logger = logging.getLogger()

handler = logging.StreamHandler(sys.stdout)
formatter = logging.Formatter(
    fmt=natcap.invest.utils.LOG_FMT,
    datefmt='%m/%d/%Y %H:%M:%S ')
handler.setFormatter(formatter)
logging.basicConfig(level=logging.INFO, handlers=[handler])

# Assumes sampledata has been all checked out.
SAMPLEDATA = os.path.join(os.path.dirname(__file__), 'data',
                          'invest-sample-data', 'HabitatRiskAssess', 'Input')
WORKSPACE_BASE = os.path.join(os.path.dirname(__file__), 'hra-sampledata')

args = {
    'aoi_vector_path': os.path.join(SAMPLEDATA, 'subregions.shp'),
    'criteria_table_path': os.path.join(
        SAMPLEDATA, 'exposure_consequence_criteria.csv'),
    'decay_eq': 'Linear',
    'info_table_path': os.path.join(SAMPLEDATA, 'habitat_stressor_info.csv'),
    'max_rating': '3',
    'resolution': '500',
    'results_suffix': '',
    'risk_eq': 'Euclidean',
    'visualize_outputs': True,
    'n_overlapping_stressors': 3,  # Now required for hra2.
    'workspace_dir': os.path.join(os.path.dirname(__file__), 'hra-sampledata'),
}

if __name__ == '__main__':
    if os.path.exists(WORKSPACE_BASE):
        shutil.rmtree(WORKSPACE_BASE)
    start_time = time.time()
    args['workspace_dir'] = os.path.join(WORKSPACE_BASE, 'current_hra')
    natcap.invest.hra.execute(args)
    old_hra_time = time.time() - start_time

    start_time = time.time()
    args['workspace_dir'] = os.path.join(WORKSPACE_BASE, 'new_hra')
    natcap.invest.hra2.execute(args)
    print(f'old elapsed: {old_hra_time}')
    print(f'elapsed: {time.time() - start_time}')
    # 13.286s for the 3.10.2 HRA
    # 8.3932s for the reimplementation.
