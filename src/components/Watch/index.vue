<script setup lang="ts">
import {
  Cpu,
  Disk,
  DownloadOne,
  UploadOne,
  Setting,
} from "@icon-park/vue-next";
import {
  onMounted,
  onUnmounted,
  ref,
  toRefs,
  computed,
  reactive,
  watch,
} from "vue";
import { bytesToMB } from "../../utils.ts";

const memoData = reactive<MemoData>({
  active: 0,
  available: 0,
  total: 0,
});
const netData = ref<NetworkStateData>({
  tx_sec: 0,
  rx_sec: 0,
});
const drawer = ref(false);
const cpu_fullLoad = ref<number>(0);
const getCpuFullLoad = async () => {
  cpu_fullLoad.value = await window.services.getCpuFullLoad();
};

async function getMemo() {
  const memo = await window.services.getMemInfo();
  memoData.active = memo.active;
  memoData.total = memo.total;
  memoData.available = memo.available;
}

async function getNetwork() {
  const net = await window.services.getNetworkInfo();
  netData.value = net;
}

let timerId: { [key: string]: NodeJS.Timeout | undefined } = {
  cpu: undefined,
  memo: undefined,
  net: undefined,
};
onMounted(() => {
  timerId.cpu = setInterval(() => {
    getCpuFullLoad();
  }, 2000);
  timerId.net = setInterval(() => {
    getNetwork();
  }, 2000);
  timerId.memo = setInterval(() => {
    getMemo();
  }, 2000);
});
onUnmounted(() => {
  for (let key in timerId) {
    clearInterval(timerId[key]);
  }
});
const colors = [
  { color: "#1989fa", percentage: 60 },
  { color: "#e6a23c", percentage: 81 },
  { color: "#f56c6c", percentage: 100 },
];
const { active, total } = toRefs(memoData);
const usedMemoPercent = computed(() => {
  if (active.value > 0) {
    return (active.value / total.value) * 100;
  } else {
    return 0;
  }
});

function openSetting() {
  drawer.value = true;
}

const cpuShow = ref(true);

watch(cpuShow, () => {
  if (cpuShow.value) {
    timerId.cpu = setInterval(() => {
      getCpuFullLoad();
    }, 2000);
  } else {
    clearInterval(timerId.cpu);
  }
});
const memoShow = ref(true);
watch(memoShow, () => {
  if (memoShow.value) {
    timerId.memo = setInterval(() => {
      getMemo();
    }, 2000);
  } else {
    clearInterval(timerId.memo);
  }
});
const netShow = ref(true);
watch(netShow, () => {
  if (netShow.value) {
    timerId.net = setInterval(() => {
      getNetwork();
    }, 2000);
  } else {
    clearInterval(timerId.net);
  }
});

const onTop = ref(false);
watch(onTop, () => {
  window.services.alwaysOnTop(onTop.value);
});
</script>

<template>
  <div class="container">
    <Bar />
    <div style="padding: 0 10px">
      <div
        style="position: fixed; bottom: 20px; right: 20px"
        @click="openSetting"
      >
        <el-button :icon="Setting"></el-button>
      </div>
      <template v-if="cpuShow">
        <WatchRow>
          <template v-slot:icon>
            <el-tooltip placement="right" content="cpu使用率">
              <Cpu />
            </el-tooltip>
          </template>
          <template v-slot:content>
            <el-progress
              :percentage="Number(cpu_fullLoad.toFixed(0))"
              :color="colors"
              :show-text="false"
            />
          </template>
        </WatchRow>
      </template>

      <template v-if="memoShow">
        <WatchRow>
          <template v-slot:icon>
            <el-tooltip placement="right" content="内存使用率">
              <Disk />
            </el-tooltip>
          </template>
          <template v-slot:content>
            <el-progress
              :percentage="Number(usedMemoPercent.toFixed(0))"
              :color="colors"
              :show-text="false"
            >
            </el-progress>
          </template>
        </WatchRow>
      </template>
      <template v-if="netShow">
        <WatchRow>
          <template v-slot:icon>
            <el-tooltip placement="right" content="下载速率">
              <DownloadOne />
            </el-tooltip>
          </template>
          <template v-slot:content>
            {{ bytesToMB(netData?.rx_sec).toFixed(2) }}MB
          </template>
        </WatchRow>
        <WatchRow>
          <template v-slot:icon>
            <el-tooltip placement="right" content="上传速率">
              <UploadOne />
            </el-tooltip>
          </template>
          <template v-slot:content>
            {{ bytesToMB(netData?.tx_sec).toFixed(2) }}MB
          </template>
        </WatchRow>
      </template>
    </div>
    <el-drawer v-model="drawer" title="展示项" size="50%">
      <div>
        <el-switch size="small" v-model="cpuShow" active-text="CPU" />
      </div>
      <div>
        <el-switch size="small" v-model="memoShow" active-text="运存" />
      </div>
      <div>
        <el-switch size="small" v-model="netShow" active-text="网络" />
      </div>
      <div>
        <el-switch size="small" v-model="onTop" active-text="钉住" />
      </div>
    </el-drawer>
  </div>
</template>
<style lang="less" scoped>
.container {
  height: 100%;
  width: 100%;
  //background-color: #ffffff;
  display: flex;
  flex-direction: column;

  .content {
    flex: 1;
    overflow: auto;
    flex-basis: 0;
    min-width: 700px;
  }
}
</style>
