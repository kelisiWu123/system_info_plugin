const constantRouterMap = [
    {
        path: '/',
        redirect: '/computer'
    },
    {
        path: '/computer',
        name: 'Computer',
        component: () => import('@/components/Watch/index.vue')
    },
]

export default constantRouterMap;